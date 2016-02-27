ko.bindingHandlers.codemirror = {
    init: function(element,valueAccessor) {
        var config = valueAccessor();
        var cm = CodeMirror.fromTextArea(element,config);
        cm.on('change',function() {
            cm.save();
            cm.getTextArea().dispatchEvent(new Event('change'));
        });
    }
}

function Challenge(name,options) {
    this.name = name;
    this.options = options;
    this.data_generator = options.data_generator;
    this.test = options.test;
    this.examples = options.examples;
    this.price = options.price;
    this.reward = options.reward;
    this.description = options.description;
    this.unlocked = ko.observable(false);

    this.current_data = ko.observable();
    this.in_progress = ko.observable(false);
}
Challenge.prototype = {
    begin: function() {
        this.current_data(this.data_generator());
        this.in_progress(true);
    },
    end: function() {
        this.current_data(null);
        this.in_progress(false);
    }
}

function unwrap_value(v) {
    if(v.isPrimitive) {
        return v.data;
    } else if(v.parent.properties.prototype.properties.splice) { //array
        var o = [];
        for(var p in v.properties) {
            o[p] = unwrap_value(v.properties[p]);
        }
        return o;
    } else if(v.type=='object') {
        var o = {};
        for(var p in v.properties) {
            o[p] = unwrap_value(v.properties[p]);
        }
        return o;
    }
    return v.toString();
}

function init_interpreter(interpreter,scope) {

    function wrap_external(fn) {
        return function() {
            var o = fn.apply({},Array.prototype.map.call(arguments,unwrap_value));
            return interpreter.createPrimitive(o);
        }
    }

    function log(msg) {
        cg.log('LOG: ',JSON.stringify(msg));
    }
    interpreter.setProperty(scope,'log',interpreter.createNativeFunction(wrap_external(log)));

    function start_challenge(name) {
        return interpreter.createPrimitive(cg.start_challenge(name));
    }
    interpreter.setProperty(scope,'challenge',interpreter.createNativeFunction(wrap_external(start_challenge)));

    function submit_challenge(name,value) {
        console.log('submitting',value);
        return cg.submit_challenge(name,value);
    }
    interpreter.setProperty(scope,'submit',interpreter.createNativeFunction(wrap_external(submit_challenge)));
}

function CookieGolf() {
    var cg = this;
    this.challenges = ko.observableArray([]);
    this.challenge_dict = ko.computed(function() {
        var o = {};
        this.challenges().forEach(function(challenge) {
            o[challenge.name] = challenge;
        });
        return o;
    },this);
    this.unlocked_challenges = ko.computed(function() {
        return this.challenges().filter(c=>c.unlocked());
    },this);

    this.code = ko.observable(localStorage.code || '');
    this.budget = ko.observable(1000);
    this.points = ko.observable(10000);
    this.total_cost = ko.observable(0);
    this.running = ko.observable(false);
    this.step_delay = ko.observable(0);
    this.num_steps = ko.observable(1);

    this.log_items = ko.observableArray([]);

    this.unlock_challenge = function(challenge) {
        if(challenge.price<=cg.points()) {
            challenge.unlocked(true);
            cg.spend(challenge.price);
            cg.log("Unlocked challenge <code>"+challenge.name+"</code> for "+challenge.price+" points");
        }
    },

    this.log("Ready to begin");
}
CookieGolf.prototype = {
    save: function() {
        var o = {
            points: this.points(),
            code: this.code(),
            challenges: this.challenges().map(function(c) {
                return {name:c.name,unlocked:c.unlocked()}
            }),
        }
        localStorage['code-clicker'] = JSON.stringify(o);
    },

    load: function() {
        var cg = this;
        var d = localStorage['code-clicker'];
        if(!d) {
            return;
        }
        d = JSON.parse(d);
        this.points(d.points);
        this.code(d.code);
        d.challenges.map(function(dc) {
            console.log(dc);
            var challenge = cg.challenge_dict()[dc.name];
            challenge.unlocked(dc.unlocked);
        });
    },

    reset: function() {
        delete localStorage['code-clicker'];
        window.location+='';
    },

    log: function() {
        var o = Array.prototype.join.call(arguments,[' ']);
        console.log(o);
        this.log_items.push(o);
    },

    spend: function(n) {
        this.points(this.points()-n);
    },

    reward: function(n) {
        this.points(this.points()+n);
    },

    add_challenge: function(name,options) {
        this.challenges.push(new Challenge(name,options));
    },

    get_challenge: function(name) {
        var challenge = this.challenge_dict()[name];
        if(!challenge) {
            throw("There's no challenge called '"+name+"'");
        }
        if(!challenge.unlocked()) {
            throw("You haven't unlocked the challenge '"+name+"' yet");
        }
        return challenge;
    },

    start_challenge: function(name) {
        var challenge = this.get_challenge(name);
        challenge.begin();
        var data = challenge.current_data();
        console.log('Start challenge '+name,data);
        this.log("Started challenge <code>"+name+"</code> with data <code>"+JSON.stringify(data,null,2)+"</code>");
        return data;
    },

    submit_challenge: function(name,value) {
        this.log("Submit challenge <code>"+name+"</code> with data <code>"+JSON.stringify(value,null,2)+"</code>");

        var challenge = this.get_challenge(name);
        if(!challenge.in_progress()) {
            throw("Challenge '"+challenge.name+"' is not in progress.");
        }
        var passed = challenge.test(value,challenge.current_data());
        this.spend(-this.total_cost());
        if(passed) {
            this.reward(challenge.reward);
            this.log("Passed! Rewarded "+challenge.reward+" points");
        } else {
            this.log("Failed.");
        }
        challenge.end();
    },

    tryStep: function() {
        var cg = this;
        var num_steps = this.num_steps();
        var go;
        for(var i=0;i<num_steps;i++) {
            go = this.step();
            if(!go) {
                break;
            }
        }
        if(go) {
            setTimeout(function() { cg.tryStep() },this.step_delay());
        }
    },

    step: function() {
        if(this.interpreter.stateStack.length) {
            var op = this.interpreter.stateStack[0];
            var cost = this.cost(op);
            if(cost>this.points()) {
                this.log("Ran out of points!");
                this.end();
                return;
            } else {
                this.spend(cost);
            }
        }
        try {
            var go = this.interpreter.step()
        } catch(e) {
            this.log("ERROR: ",e);
            console.log(e.stack);
            return false;
        }
        return go;
    },

    end: function() {
        this.running(false);
    },

    run: function(code) {
        var interpreter = this.interpreter = new Interpreter(this.code(),init_interpreter);
        this.total_cost(0);

        this.running(true);
        this.tryStep();
    },

    cost: function(op) {
        switch(op.node.type) {
            case 'FunctionDeclaration':
            case 'FunctionExpression':
            case 'ArrowExpression':
                return 100;
            case 'VariableDeclarator':
                return op.done ? 5 : 0;
            case 'AssignmentExpression':
                return op.doneLeft && op.doneRight ? 5 : 0;
            case 'ArrayExpression':
                return 1;
            case 'ObjectExpression':
                return 1;
            case 'UnaryExpression':
                return op.done ? 10 : 0;
            case 'BinaryExpression':
                return op.doneLeft && op.doneRight ? 10 : 0;
            case 'UpdateExpression':
                return op.done ? 3 : 0;
            case 'LogicalExpression':
                return 5;
            case 'ConditionalExpression':
                return op.done ? 3 : 0;
            case 'NewExpression': 
            case 'CallExpression':
                return op.doneExec ? 20 : 0;
            case 'YieldExpression':
            case 'ComprehensionExpression':
            case 'GeneratorExpression':
                return 1;
            case 'Literal':
                return 1;
            case 'ConditionalExpression':
            case 'IfStatement':
            case 'BreakStatement':
            case 'ContinueStatement':
            case 'WithStatement':
            case 'SwitchStatement':
            case 'Return Statement':
            case 'ThrowStatement':
            case 'WhileStatement':
            case 'DoWhileStatement':
                return 1;
            default:
                return 0;
        }
    }
}

var cg = new CookieGolf();

cg.add_challenge('say_hi',{
    reward: 60,
    price: 1000,
    description: "Greet incoming guests",
    data_generator: function() {
        return "Bob";
    },
    test: function(value,data) {
        return value=='Hi '+data;
    },
    examples: [
        {
            from: 'Bob',
            to: 'Hi Bob'
        }
    ]
})

cg.add_challenge('announce',{
    reward: 100,
    price: 10000,
    description: 'Announce guests at a ball, with their full titles',
    data_generator: function() {
        return {
            first_name: "Bob",
            second_name: "Smythe",
            title: "Lord",
        }
    },
    test: function(value,data) {
        return data.title+' '+data.first_name+' '+data.second_name;
    },
    examples: [
        {
            from: {
                first_name: "Bob",
                second_name: "Smythe",
                title: "Lord",
            },
            to: "Lord Bob Smythe"
        }
    ]
});

cg.add_challenge('factorise',{
    reward: 0,
    price: 0,
    description: "Factorise a given number",
    data_generator: function() {
        return Math.floor(Math.random()*100+10);
    },
    test: function(value,data) {
        function is_prime(n) {
            if(n<2) {
                return false;
            }
            for(var i=2;i*i<=n;i++) {
                if(n%i==0) {
                    return false;
                }
            }
            return true;
        }
        return value.every(is_prime) && value.reduce((t,x)=>t*x,1)==data;
    },
    examples: [
        {
            from: 24,
            to: [2,2,2,3]
        }
    ]
});

cg.load();

// save state
ko.computed(function() {
    cg.save();
},this);


ko.applyBindings(cg);

document.getElementById('run').addEventListener('click',function() {
    console.clear();
    var code = document.getElementById('code').value;
    localStorage.code = code;
    cg.run(code,1000);
});

document.getElementById('code').value = localStorage.code || '';
