ko.options.deferUpdates = true;

function reset() {
    delete localStorage['code-clicker'];
    window.location+='';
}

function debug(msg) {
}

function save_raw_attrs(obj,out,attrs) {
	attrs.forEach(function(attr) {
		out[attr] = ko.unwrap(obj[attr]);
	});
}

function load_raw_attrs(obj,data,attrs) {
	attrs.forEach(function(attr) {
		obj[attr](data[attr]);
	});
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

function randrange(min,max) {
    return Math.floor(Math.random()*(max-min))+min;
}

function choice(list) {
	var i = Math.floor(Math.random()*list.length);
	return list[i];
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
	save_raw_attrs: ['unlocked'],

    save: function() {
        var out = {
            name: this.name
		}
		save_raw_attrs(this,out,this.save_raw_attrs);
		return out;
    },

    load: function(d) {
		load_raw_attrs(this,d,this.save_raw_attrs);
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
	save_raw_attrs: ['unlocked','num_bought','price'],

    save: function() {
		var o = {
            name: this.name
		}
		save_raw_attrs(this,o,this.save_raw_attrs);
		return o;
    },
    load: function(d) {
		load_raw_attrs(this,d,this.save_raw_attrs)
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
        change.update(change.from,change.to,change.text.map(function(l){return l.slice(0,80)}));
        if(change.text.length>processor.cg.max_lines()) {
            change.update(change.from,change.to,change.text.slice(0,processor.cg.max_lines()));
        }
    }
    this.running = ko.observable(false);
	this.keep_running = ko.observable(false);
    this.log_items = ko.observableArray([]);
	this.show_output = ko.observable(true);

    this.step_delay = cg.step_delay;
    this.execution_speed = cg.execution_speed;

    this.log('info',"Ready to begin");
	
	this.num_steps = ko.observable(0);
}
Processor.prototype = {
	save_raw_attrs: ['code','keep_running'],

    save: function() {
		var o = {};
		save_raw_attrs(this,o,this.save_raw_attrs);
		return o;
    },

    load: function(data) {
		load_raw_attrs(this,data,this.save_raw_attrs);
    },

    log: function(kind,message) {
        var bits = Array.prototype.slice.call(arguments,[1]);
        var o = Array.prototype.join.call(bits,[' ']);
        debug(o);
        kind = {'info':'info','bad':'danger','success':'success','log':'default'}[kind] || 'default';
        this.log_items.splice(0,0,{kind:'text-'+kind,message:o});
    },

    start_challenge: function(name) {
        var challenge = this.cg.get_challenge(name);
        var data = this.challenge_data[name] = challenge.data_generator();
        debug('Start challenge '+name,data);
        this.log('info',"Started challenge <code>"+name+"</code> with data <code>"+JSON.stringify(data,null,2)+"</code>");
        return data;
    },

    submit_challenge: function(name,value) {
        this.log('info',"Submit challenge <code>"+name+"</code> with data <code>"+JSON.stringify(value,null,2)+"</code>");

        var challenge = this.cg.get_challenge(name);
        if(this.challenge_data[name]===undefined) {
            throw("Challenge '"+challenge.name+"' is not in progress.");
        }
        var passed = challenge.test(value,this.challenge_data[name]);
        if(passed) {
            this.cg.reward(challenge.reward);
            this.log('success',"Passed! Rewarded "+challenge.reward+" points");
        } else {
            this.log('bad',"Failed.");
        }
        delete this.challenge_data[name];
    },

    tryStep: function() {
		if(!this.running()) {
			return;
		}
        var processor = this;
        var execution_speed = this.execution_speed() + (this.steps_remaining || 0);
		this.steps_remaining = 0;
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
			this.steps_remaining = execution_speed - i;
            this.end();
        }
    },

    step: function() {
		this.step_success = false;
		this.num_steps(this.num_steps()+1);
		if(this.num_steps()>this.cg.max_steps()) {
			this.log('bad',"Took too long to finish!");
			return;
		}

        if(this.interpreter.stateStack.length) {
            var op = this.interpreter.stateStack[0];
            var cost = this.cost(op);
            this.step_cost += cost;
            if(cost>this.cg.points()) {
                this.log('bad',"Ran out of points: cost of "+op.node.type+" is "+cost+" points!");
                return;
            } else {
                this.cg.spend(cost);
            }
        }
        try {
            var go = this.interpreter.step();
        } catch(e) {
            this.log('bad',"ERROR: ",e);
            debug(e.stack);
            return false;
        }
		this.step_success = true;
        return go;
    },

    cost: function(op) {
        return this.cg.cost(op);
    },

    end: function() {
        this.running(false);
		this.log('info',"Finished running after "+this.num_steps()+" steps");
		this.run_times -= 1;
		if(this.keep_running() && this.step_success && this.run_times>0) {
			setTimeout(this.run(),100);
		}
    },

	start_run: function() {
		this.log_items([]);
		this.run_times = this.cg.run_times();
		this.run();
	},

	stop_run: function() {
		this.run_times = 0;
		this.end();
	},

    run: function() {
        if(this.running()) {
            return;
        }

		this.log('info',"Beginning a run");

        var processor = this;

        this.challenge_data = {};

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
                processor.log('log','LOG: ',JSON.stringify(msg));
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
	this.visible_challenges = ko.computed(function() {
		var challenges = this.challenges();
		for(var i=challenges.length-1;i>=0 && !challenges[i].unlocked();i--) {
		}
		return challenges.slice(0,i+2);
	},this);

    this.perk_threads = ko.observableArray([]);

    this.budget = ko.observable(1000);
    this.points = int_obs(2000);

    this.step_delay = ko.observable(100);
    this.execution_speed = ko.observable(1);

	this.run_times = ko.observable(1);

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
    save_raw_attrs: ['points','execution_speed','step_delay','max_lines','max_steps','run_times'],

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
		save_raw_attrs(this,o,this.save_raw_attrs);

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

		load_raw_attrs(this,d,this.save_raw_attrs);

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

for(var name in challenge_configs) {
	console.log(name);
	cg.add_challenge(name,challenge_configs[name]);
};

perk_threads.forEach(function(td) {
	cg.add_perk_thread(td);
});

cg.load();

// save state
ko.computed(function() {
    cg.save();
},this).extend({throttle:1000});


ko.applyBindings(cg);
