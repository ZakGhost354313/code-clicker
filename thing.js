function debug(msg) {
}

// Knockout codemirror binding handler
ko.bindingHandlers.codemirror = {
    init: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        var options = {mode:'javascript', lineNumbers:true};
        options.value = ko.unwrap(valueAccessor());
        var editor = CodeMirror.fromTextArea(element, options);
        var value = valueAccessor();

        editor.on('change', function(cm) {
            var value = valueAccessor();
            value(cm.getValue());
        });
        if(value.clean) {
            editor.on('beforeChange',function(cm,change) {
                var value = valueAccessor();
                value.clean(change);
            });
        }

        element.editor = editor;
    },
    update: function(element, valueAccessor, allBindings, viewModel, bindingContext) {
        var observedValue = ko.unwrap(valueAccessor());
        if (element.editor) {
            var pos = element.editor.getCursor();
            element.editor.setValue(observedValue);
            element.editor.refresh();
            element.editor.setCursor(pos);
        }
    }
};

function Challenge(cg,name,options) {
    this.cg = cg;
    this.name = name;
    this.options = options;
    this.data_generator = options.data_generator;
    this.test = options.test;
    this.examples = options.examples;
    this.price = options.price;
    this.reward = options.reward;
    this.description = options.description;
    this.unlocked = ko.observable(false);

    this.progress = ko.computed(function() {
        var p = this.cg.points()/this.price;
        return Math.min(p,1)*100;
    },this);
}
Challenge.prototype = {
    save: function() {
        return {
            name: this.name,
            unlocked: this.unlocked()
        }
    },
    load: function(d) {
        this.unlocked(d.unlocked);
    }
}

function Perk(cg,options) {
    this.cg = cg;
    this.name = options.name;
    this.repeats = options.repeats;
    this.description = options.description;
    this.price = options.price;
    this.unlocked = ko.observable(false);
    this.num_bought = ko.observable(0);
    this.apply = options.apply;
    this.sell = options.sell;

    this.progress = ko.computed(function() {
        var p = this.cg.points()/this.price;
        return Math.min(p,1)*100;
    },this);
}
Perk.prototype = {
    save: function() {
        return {
            name: this.name,
            unlocked: this.unlocked(),
            num_bought: this.num_bought()
        }
    },
    load: function(d) {
        this.unlocked(d.unlocked);
        this.num_bought(d.num_bought);
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

function Processor(cg) {
    var processor = this;
    this.cg = cg;
    this.code = ko.observable('');
    this.code.clean = function(change) {
        if(change.text.length>processor.cg.max_lines()) {
            change.update(change.from,change.to,change.text.slice(0,processor.cg.max_lines()));
        }
    }
    this.running = ko.observable(false);
    this.log_items = ko.observableArray([]);

    this.step_delay = cg.step_delay;
    this.num_steps = cg.num_steps;

    this.log("Ready to begin");

    this.challenge_data = {};
}
Processor.prototype = {
    save: function() {
        return {
            code: this.code()
        }
    },

    load: function(data) {
        this.code(data.code);
    },

    log: function() {
        var o = Array.prototype.join.call(arguments,[' ']);
        debug(o);
        this.log_items.push(o);
    },

    start_challenge: function(name) {
        var challenge = this.cg.get_challenge(name);
        var data = this.challenge_data[name] = challenge.data_generator();
        debug('Start challenge '+name,data);
        this.log("Started challenge <code>"+name+"</code> with data <code>"+JSON.stringify(data,null,2)+"</code>");
        return data;
    },

    submit_challenge: function(name,value) {
        this.log("Submit challenge <code>"+name+"</code> with data <code>"+JSON.stringify(value,null,2)+"</code>");

        var challenge = this.cg.get_challenge(name);
        if(this.challenge_data[name]===undefined) {
            throw("Challenge '"+challenge.name+"' is not in progress.");
        }
        var passed = challenge.test(value,this.challenge_data[name]);
        if(passed) {
            this.cg.reward(challenge.reward);
            this.log("Passed! Rewarded "+challenge.reward+" points");
        } else {
            this.log("Failed. Expected <code>"+JSON.stringify(this.challenge_data[name],null,2)+"</code>");
        }
        delete this.challenge_data[name];
    },

    tryStep: function() {
        var processor = this;
        var num_steps = this.num_steps();
        var go;
        this.step_cost = 0;
        for(var i=0;i<num_steps;i++) {
            go = this.step();
            if(!go) {
                break;
            }
        }
        if(go) {
            var delay = this.step_cost > 0 ? this.step_delay() : 0;
            setTimeout(function() { processor.tryStep() }, delay);
        } else {
            this.end();
        }
    },

    step: function() {
        if(this.interpreter.stateStack.length) {
            var op = this.interpreter.stateStack[0];
            var cost = this.cost(op);
            this.step_cost += cost;
            if(cost>this.cg.points()) {
                this.log("Ran out of points!");
                this.end();
                return;
            } else {
                this.cg.spend(cost);
            }
        }
        try {
            var go = this.interpreter.step();
        } catch(e) {
            this.log("ERROR: ",e);
            debug(e.stack);
            this.end();
            return false;
        }
        return go;
    },

    cost: function(op) {
        return this.cg.cost(op);
    },

    end: function() {
        this.running(false);
    },

    run: function(code) {
        if(this.running()) {
            return;
        }

        var processor = this;

        this.challenge_data = {};

        function init_interpreter(interpreter,scope) {
            function wrap_external(fn) {
                return function() {
                    var o = fn.apply({},Array.prototype.map.call(arguments,unwrap_value));
                    if(typeof(o)=='object') {
                        var io = interpreter.createObject();
                        for(var key in o) {
                            interpreter.setProperty(io,key,interpreter.createPrimitive(o[key]));
                        }
                        return io;
                    } else {
                       return interpreter.createPrimitive(o);
                    }
                }
            }

            function log(msg) {
                processor.log('LOG: ',JSON.stringify(msg));
            }
            interpreter.setProperty(scope,'log',interpreter.createNativeFunction(wrap_external(log)));

            function start_challenge(name) {
                return processor.start_challenge(name);
            }
            interpreter.setProperty(scope,'challenge',interpreter.createNativeFunction(wrap_external(start_challenge)));

            function submit_challenge(name,value) {
                debug('submitting',value);
                return processor.submit_challenge(name,value);
            }
            interpreter.setProperty(scope,'submit',interpreter.createNativeFunction(wrap_external(submit_challenge)));
        }

        var interpreter = this.interpreter = new Interpreter(this.code(),init_interpreter);

        this.running(true);
        this.tryStep();
    },

}

function CodeClicker() {
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

    this.perk_threads = ko.observableArray([]);

    this.budget = ko.observable(1000);
    this.points = ko.observable(2000);

    this.step_delay = ko.observable(100);
    this.num_steps = ko.observable(1);

    this.max_lines = ko.observable(2);

    this.processors = ko.observableArray([]);
    this.show_processor = ko.observable(this.processors()[0]);

    this.unlock_challenge = function(challenge) {
        if(challenge.price<=cg.points()) {
            challenge.unlocked(true);
            cg.spend(challenge.price);
        }
    }
    this.sell_challenge = function(challenge) {
        cg.reward(challenge.price);
        challenge.unlocked(false);
    }

    this.unlock_perk = function(perk) {
        if(perk.price<=cg.points()) {
            if(!perk.repeats) {
                perk.unlocked(true);
            }
            perk.num_bought(perk.num_bought()+1);
            cg.spend(perk.price);
            perk.apply(cg);
        }
    }

    this.sell_perk = function(perk) {
        perk.sell(cg);
        cg.reward(perk.price);
        if(perk.repeats) {
            perk.unlocked(false);
        }
        perk.num_bought(perk.num_bought()-1);
    }
}
CodeClicker.prototype = {
    save_raw_attrs: ['points','num_steps','step_delay','max_lines'],

    init: function() {
        this.show_processor(this.add_processor());
        this.points(1000);
    },

    save: function() {
        var cg = this;
        var o = {
            challenges: this.challenges().map(function(c) { return c.save() }),
            processors: this.processors().map(function(p) { return p.save() }),
            perk_threads: this.perk_threads().map(function(t) {
                return t.map(function(p){ return p.save() });
            })
        }
        this.save_raw_attrs.forEach(function(attr) {
            o[attr] = ko.unwrap(cg[attr]);
        });
        localStorage['code-clicker'] = JSON.stringify(o);
    },

    load: function() {
        var cg = this;
        var d = localStorage['code-clicker'];
        if(!d) {
            this.init();
            return;
        }
        d = JSON.parse(d);

        this.save_raw_attrs.forEach(function(attr) {
            cg[attr](d[attr]);
        });

        d.challenges.map(function(dc) {
            debug(dc);
            var challenge = cg.challenge_dict()[dc.name];
            challenge.load(dc);
        });

        d.perk_threads.map(function(dt,i) {
            var thread = cg.perk_threads()[i];
            dt.map(function(dp,j) {
                thread[j].load(dp);
            });
        });

        d.processors.map(function(dp) {
            var processor = cg.add_processor();
            processor.load(dp);
        });
        this.show_processor(this.processors()[0]);
    },

    reset: function() {
        delete localStorage['code-clicker'];
        window.location+='';
    },

    spend: function(n) {
        this.points(this.points()-n);
    },

    reward: function(n) {
        this.points(this.points()+n);
    },

    add_processor: function() {
        var p = new Processor(this);
        this.processors.push(p);
        return p;
    },

    add_challenge: function(name,options) {
        this.challenges.push(new Challenge(this,name,options));
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

    add_perk_thread: function(thread) {
        var cg = this;
        this.perk_threads.push(thread.map(function(options){ return new Perk(cg,options)}));
    },

    cost: function(op) {
        switch(op.node.type) {
            case 'FunctionDeclaration':
            case 'FunctionExpression':
            case 'ArrowExpression':
                return 1000;
            case 'VariableDeclarator':
                return op.done ? 50 : 0;
            case 'AssignmentExpression':
                return op.doneLeft && op.doneRight ? 5 : 0;
            case 'ArrayExpression':
                return 1;
            case 'ObjectExpression':
                return 1;
            case 'UnaryExpression':
                return op.done ? 30 : 0;
            case 'BinaryExpression':
                return op.doneLeft && op.doneRight ? 30 : 0;
            case 'UpdateExpression':
                return op.done ? 3 : 0;
            case 'LogicalExpression':
                return 5;
            case 'ConditionalExpression':
                return op.done ? 3 : 0;
            case 'NewExpression': 
            case 'CallExpression':
                return op.doneExec ? 100 : 0;
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

var cg = new CodeClicker();

cg.add_challenge('echo',{
    reward: 260,
    price: 500,
    description: "Return what you're given",
    data_generator: function() {
        return Math.random()*1000;
    },
    test: function(value,data) {
        return value==data;
    },
    examples: [
        {
            from: 0.13214,
            to: 0.13214
        }
    ]
})

cg.add_challenge('announce',{
    reward: 500,
    price: 15000,
    description: 'Announce guests at a ball, with their full titles',
    data_generator: function() {
        return {
            first_name: "Bob",
            second_name: "Smythe",
            title: "Lord",
        }
    },
    test: function(value,data) {
        var expect  = data.title+' '+data.first_name+' '+data.second_name;
        return value==expect;
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
    reward: 3000,
    price: 50000,
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

cg.add_perk_thread([
    {
        name: 'Execution Speed 1',
        description: '2× execution speed',
        price: 1000,
        apply: function(cg) {
            cg.num_steps(cg.num_steps()*2);
        },
        sell: function(cg) {
            cg.num_steps(cg.num_steps()/2);
        }
    },
    {
        name: 'Execution Speed 2',
        description: '3× execution speed',
        price: 5000,
        apply: function(cg) {
            cg.num_steps(3*cg.num_steps());
        },
        sell: function(cg) {
            cg.num_steps(cg.num_steps()/3);
        }
    },
    {
        name: 'Execution Speed 3',
        description: '4× execution speed',
        price: 10000,
        apply: function(cg) {
            cg.num_steps(4*cg.num_steps());
        },
        sell: function(cg) {
            cg.num_steps(cg.num_steps()/4);
        }
    },
]);
cg.add_perk_thread([
    {
        name: 'One more line',
        description: '+1 maximum lines',
        price: 1000,
        repeats: true,
        apply: function(cg) {
            cg.max_lines(cg.max_lines()+1);
        },
        sell: function(cg) {
            cg.max_lines(cg.max_lines()-1);
        }
    }
]);

cg.load();

// save state
ko.computed(function() {
    cg.save();
},this).extend({throttle:1000});


ko.applyBindings(cg);
