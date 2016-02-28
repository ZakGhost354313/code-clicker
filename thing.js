function debug(msg) {
}

function int_obs(v) {
	var obs = ko.observable(v);
	return ko.computed({
		read: function() {
			return Math.round(obs());
		},
		write: function(v) {
			return obs(v);
		}
	});
}

ko.bindingHandlers.progress = {
	update: function(element, valueAccessor) {
		var value = ko.unwrap(valueAccessor());
		element.style.width = value*100+'%';
		element.classList.toggle('progress-bar-success',value==1);
		element.classList.toggle('progress-bar-striped',value==1);
		element.classList.toggle('active',value==1);
	}
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
        return Math.min(p,1);
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

function Perk(cg,options,last) {
    this.cg = cg;
	this.last = last;
	this.next = ko.observable(null);
    this.name = options.name;
    this.repeats = options.repeats;
    this.description = options.description;
	this.price = int_obs(options.price);
	this.price_factor = options.price_factor || 1;
    this.unlocked = ko.observable(false);
    this.num_bought = ko.observable(0);
    this.apply = options.apply;
    this.sell = options.sell;
	this.sell_price = ko.computed(function() {
		return this.price()/this.price_factor;
	},this);

	this.visible = ko.computed(function() {
		var next_bought = this.next() && this.next().num_bought()>0;
		return (this.last==null || this.last.num_bought()>0) && !next_bought;
	},this);

    this.progress = ko.computed(function() {
        var p = this.cg.points()/this.price();
        return Math.min(p,1);
    },this);

	if(last) {
		last.next(this);
	}
}
Perk.prototype = {
    save: function() {
        return {
            name: this.name,
            unlocked: this.unlocked(),
            num_bought: this.num_bought(),
			price: this.price()
        }
    },
    load: function(d) {
        this.unlocked(d.unlocked);
        this.num_bought(d.num_bought);
		this.price(d.price);
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
	this.show_output = ko.observable(true);

    this.step_delay = cg.step_delay;
    this.execution_speed = cg.execution_speed;

    this.log("Ready to begin");
	
	this.num_steps = ko.observable(0);
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
        this.log_items.splice(0,0,o);
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
        var execution_speed = this.execution_speed();
        var go;
        this.step_cost = 0;
        for(var i=0;i<execution_speed;i++) {
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
		this.num_steps(this.num_steps()+1);
		if(this.num_steps()>this.cg.max_steps()) {
			this.log("Took too long to finish!");
			return;
		}

        if(this.interpreter.stateStack.length) {
            var op = this.interpreter.stateStack[0];
            var cost = this.cost(op);
            this.step_cost += cost;
            if(cost>this.cg.points()) {
                this.log("Ran out of points: cost of "+op.node.type+" is "+cost+" points!");
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
		this.log("Finished running after "+this.num_steps()+" steps");
    },

    run: function(code) {
        if(this.running()) {
            return;
        }

        var processor = this;

        this.challenge_data = {};

		this.log_items([]);
		this.num_steps(0);

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
    this.points = int_obs(2000);

    this.step_delay = ko.observable(100);
    this.execution_speed = ko.observable(1);

    this.max_lines = ko.observable(2);
	this.max_steps = ko.observable(25);

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
        if(perk.price()<=cg.points()) {
            if(!perk.repeats) {
                perk.unlocked(true);
            }
            perk.num_bought(perk.num_bought()+1);
            cg.spend(perk.price());
            perk.apply(cg);
			perk.price(perk.price()*perk.price_factor);
        }
    }

    this.sell_perk = function(perk) {
        perk.sell(cg);
        cg.reward(perk.price());
        if(!perk.repeats) {
            perk.unlocked(false);
        }
        perk.num_bought(perk.num_bought()-1);
		perk.price(perk.price()/perk.price_factor);
    }
}
CodeClicker.prototype = {
    save_raw_attrs: ['points','execution_speed','step_delay','max_lines','max_steps'],

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
        this.points(this.points()-Math.floor(n));
    },

    reward: function(n) {
        this.points(this.points()+Math.floor(n));
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
		var perk = null;
        this.perk_threads.push(thread.map(function(options){ 
			perk = new Perk(cg,options,perk);
			return perk;
		}));
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

perk_threads.forEach(function(td) {
	cg.add_perk_thread(td);
});

cg.load();

// save state
ko.computed(function() {
    cg.save();
},this).extend({throttle:1000});


ko.applyBindings(cg);
