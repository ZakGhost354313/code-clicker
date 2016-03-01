var challenge_configs = {
	'echo': {
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
	},

	'announce': {
		reward: 500,
		price: 10000,
		description: 'Announce guests at a ball, with their full titles',
		data_generator: function() {
			return {
				first_name: choice(corpora['firstNames.json'].firstNames),
				second_name: choice(corpora['lastNames.json'].lastNames),
				title: choice(corpora['englishHonorifics.json'].englishHonorifics),
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
	},

    'fizzbuzz-single': {
        reward: 750,
        price: 20000,
        description: "If the given number is a multiple of 3, return <code>'Fizz'</code>. If it's a multiple of 5, return <code>'Buzz'</code>. If both, return <code>'FizzBuzz'</code>. If neither, return the number.",
        data_generator: function() {
            return Math.floor(Math.random()*10000);
        },
        test: function(value,data) {
            switch(0) {
                case data%15:
                    return value=='FizzBuzz';
                case data%3:
                    return value=='Fizz';
                case data%5:
                    return value=='Buzz';
                default:
                    return value==data;
            }
        },
        examples: [
            {from: 2, to: 2},
            {from: 18, to: 'Fizz'},
            {from: 105, to: 'Buzz'},
            {from: 75, to: 'FizzBuzz'}
       ]
    },

	'factorise1': {
		reward: 3000,
		price: 50000,
		description: "Factorise a given number between 10 and 100",
		data_generator: function() {
			return Math.floor(Math.random()*90+10);
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
	},

    'caesar-cypher': {
        reward: 10000,
        price: 100000,
        description: "Replace each letter in the given string with the letter <code>n</code> places further down the alphabet. Leave other characters unchanged.",
        data_generator: function() {
            return {
                phrase: choice(corpora['shakespeare_phrases.json'].phrasess).trim(),
                n: randrange(-60,60)
            }
        },
        test: function(value,data) {
            var alphabet_lower = 'abcdefghijklmnopqrstuvwxyz';
            var alphabet_upper = alphabet_lower.toUpperCase();
            var map = {};
            for(var i=0;i<alphabet_lower.length;i++) {
                var j = (i-data.n)%alphabet_lower.length;
                while(j<0) {
                    j += alphabet_lower.length;
                }
                map[alphabet_lower[i]] = alphabet_lower[j];
                map[alphabet_upper[i]] = alphabet_upper[j];
            }
            var mapped = value.split('').map(function(x){return map[x] || x}).join('');
            return data.phrase==mapped;
        },
        examples: [
            {
                from: { "phrase": "Tedious as a twice-told tale", "n": 25 },
                to: "Sdchntr zr z svhbd-snkc szkd"
            },
            {
                from: { "phrase": "Comparisons are odorous", "n": -48 },
                to: "Gsqtevmwsrw evi shsvsyw"
            }
        ]
    },

	'factorise2': {
		reward: 30000,
		price: 500000,
		description: "Factorise a given number between 100 and 1000",
		data_generator: function() {
			return Math.floor(Math.random()*900+100);
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
				from: 234,
				to: [2,3,3,13]
			}
		]
	},
}


