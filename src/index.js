var fs = require("fs");
var path = require("path");
var libString = require("../lib/js/string");
var libArray = require("../lib/js/array");
var libObject = require("../lib/js/object");
var libFile = require("../lib/nodejs/file");
var sync = require("../lib/js/sync");
//var utils =require("./utils");
var log = require("../lib/nodejs/log");
var tmpl = require("./tmpl");

module.exports = Disp;
function defaultCallback(err){
	if(err) throw err;
	else log.i("done");
}
function Disp(config, fn){
	var self = this;
	if(!fn) fn = defaultCallback;
	if(!config) config = {};
	self.callback = fn;
	self.keyCounts = {};//for default instance
	self.deps = {};
	if(!config.dispDir) config.dispDir = path.resolve(__dirname + "/..");
	if(!config.projectDir) config.projectDir = ".";
	if(!config.baseDir) config.baseDir = config.projectDir;
	if(!config.deps) config.deps = {};

	self.global = {
		env: config,
		main: {},
		ns: {}
	};
	self.src = {};
	self.filelist = {};
}
//require("./az")(Disp.prototype);
//require("./ev")(Disp.prototype);
//require("./gn")(Disp.prototype);
Disp.prototype.run = function(){
	var self = this;
	var env = self.global.env;
	self.src = libFile.readJson("disp.json");
	
	for(var i in self.src){
		self.addcpt(self.src[i]);
	}
	self.impl();
	self.gen();
//	self.readSrc();
//	self.analyzeSrc();
//	self.evalGlobal();
//	self.genFilelist();
	self.dispose();
}
Disp.prototype.addcpt = function(json){
	var self = this;
	var env = self.global.env;
	var cpt = Object.keys(json)[0];
	var indexFile = env.dispDir + "/cpt/" + cpt + "/index.def";
	if(!json.name){
		if(!self.keyCounts[cpt])
			self.keyCounts[cpt] = 1;
		else
			self.keyCounts[cpt] ++;
		json.name = cpt + self.keyCounts[cpt];
	}
	json.cpt = cpt;
	
	self.global.ns[json.name] = json;
	if(!self.global.ns[cpt])
		self.global.ns[cpt] = {
			instances: {}
		};
	self.global.ns[cpt].instances[json.name] = json;
//concept
	if(fs.existsSync(indexFile)){
		tmpl.render({
			file: indexFile,
			pre: "^^",
			post: "$$",
			argv: json[cpt],
			extend: {
				default: function(key, val){
					if(!json.hasOwnProperty(key)){
						json[key] = val;
					}
				},
				childof: function(d){
					if(!self.deps[cpt])
						self.deps[cpt] = {};
					self.deps[cpt][d]=1;
					var jsonnew = {};
					jsonnew[d] = libObject.copy(json[cpt], jsonnew);
					self.addcpt(jsonnew);
				},
				partof: function(tname){
					var mp = self.global.ns[tname];
					if(mp.instances){
// is class
						if(json[tname]) return;
						tname = Object.keys(mp.instances)[0];
						mp = self.global.ns[tname];
					}
// is instance
					if(!mp.content) mp.content= {};
					mp.content[json.name] = json;
					if(!mp[cpt]) mp[cpt] = {};
					mp[cpt][json.name] = json;
					json[mp.cpt] = tname;
					json.lang = mp.lang;
				},
				relto: function(tname){
					var mp = self.global.ns[tname];
					if(mp.instances){
// is class
						if(json[tname]) return;
						tname = Object.keys(mp.instances)[0];
						mp = self.global.ns[tname];
					}
// is instance
					if(!mp.content) mp.content= {};
					mp.content[json.name] = json;
					if(!mp[cpt]) mp[cpt] = {};
					mp[cpt][json.nmae] = json;
					json[mp.cpt] = tname;
				},
				addcpt: function(json){
					self.addcpt(json);
				},
				addfs: function(json){
					libObject.extend(self.filelist, json);
				},
				asmain: function(){
					if(!self.global.main[json.lang])
						self.global.main[json.lang] = {};
					self.global.main[json.lang][json.name] = json;
				}
			},
			global: self.global
		}, json);
	}
}
Disp.prototype.impl = function(){
	var self = this;
	var env = self.global.env;
	for(var key in self.global.main){
		var localenv = {};
		localenv[key] = self.global.main[key];
		self.addcpt(localenv);		
	}
}
Disp.prototype.getstr = function(localenv){
	var self = this;
	var env = self.global.env;
	var cfile = self.getfile(localenv.cpt, localenv.lang);
	if(!cfile){
		log.w("not impl "+localenv.cpt + " "+ localenv.lang);
		return;
	}
	var prestr = "";
	var poststr = "";
//implmentation
	var str = tmpl.render({
		file: cfile,
		argv: localenv[localenv.cpt],
		extend: {
			eval: function(json, lang){
				json.lang = lang || localenv.lang;
				self.addcpt(json);
				return self.getstr(json);
			},
			require: function(d){
				prestr += self.getstr({
					require: d,
					cpt: "require", 
					lang: localenv.lang
				});
			}			
		},
		global: self.global
	}, localenv);
	return prestr + str + poststr;
}
Disp.prototype.gen = function(){
	var self = this;
	var env = self.global.env;
	if(!env.targetDir) env.targetDir = ".";
//one time
	for(var key in self.filelist){
		var config = self.filelist[key];
		var localenv = config.env;
		self.getstr(localenv);
	}
//two times
	for(var key in self.filelist){
		var tfilename = env.targetDir + "/" + key;
		var config = self.filelist[key];
		var localenv = config.env;
		var str = self.getstr(localenv);
		libFile.mkdirpSync(path.dirname(tfilename)); //to be acc
		if(fs.existsSync(tfilename))
			fs.unlinkSync(tfilename);
		self.fileCount ++;
		var mode;
		if(config.exec){
			mode = 0555;
			str = "#!/usr/bin/env "+ config.exec + "\n" + str;
		}else{
			mode = 0444;
		}
		fs.writeFileSync(tfilename, str, {mode: mode});
	}
}
Disp.prototype.getfile = function(cpt, lang){
	var self = this;
	var env = self.global.env;
	var f = env.dispDir + "/cpt/"+cpt+"/"+lang + ".imp";
	if(fs.existsSync(f)){
		return f;
	}
	for(var key in self.deps[lang]){
		var f2 = self.getfile(cpt, key);
		if(f2) return f2;			
	}
	return "";
}
/*
Disp.prototype.readSrc = function(){
	var self = this;
	var env = self.global.env;
// init env;
	self.readDispJson("disp.json");
	if(fs.existsSync(self.projectDir + "/disp")){
//disp directory exists
		libFile.forEachFile(self.projectDir + "/disp", function(f){
			if(!f.match(/\.json$/)) return;
			self.readDispJson("disp/" + f);
		});
		libFile.forEachDir(self.projectDir + "/disp", function(f){
			var config;
			//read dir config
			if(fs.existsSync("disp/"+f+"/index.json"))
				config = libFile.readJson("disp/"+f+"/index.json");
			libFile.forEachFile(self.projectDir + "/disp/"+f, function(subf){
				if(!subf.match(/\.json$/)) return;
				if(subf == "index.json") return;
				self.readDispJson("disp/"+f+"/"+subf, config);
			});
		});
	}		
	if(env.dispJsonExFile){
		if(!env.dispJsonExFile.match(/\.json$/))
			env.dispJsonExFile = env.dispJsonExFile + ".json";
		self.readDispJson(self.dispJsonExFile);
	}
	if(!env.targetDir) env.targetDir = ".";
	if(!env.targetBaseDir) env.targetBaseDir = env.targetDir;

	log.v("extend global done");
}
Disp.prototype.analyzeSrc = function(){
	var self = this;
	var env = self.global.env;
	self.analyze(self.src);
	console.log(JSON.stringify(self.global,undefined,2));
}
Disp.prototype.evalGlobal = function(){
	var self = this;
	self.eval(self.global);
}
Disp.prototype.genFilelist = function(){
	var self = this;
	self.generate(self.filelist);		
}

Disp.prototype.readDispJson = function(jsonFile, config){
	var self = this;
	var env = self.global.env;
	if(!fs.existsSync(env.projectDir + "/" + jsonFile)){
// if not exists, warn
		log.i("ignore " + env.projectDir + "/" + jsonFile);
		return;
	}
	// init renderEnv
	var renderEnv;
	if(config && config.mount){
		renderEnv = libObject.getByKey(self.global, config.mount);
		if(!renderEnv){
			// if mount point not exists, init
			renderEnv = {};
			libObject.setByKey(self.global, config.mount, renderEnv);
		}
	}else{
		renderEnv = self.global;
	}
	var json = tmpl.render({
		file: env.projectDir + "/" + jsonFile,
		extend: {
			eval:	function(json, lang){
				if(lang) return self.eval(json, lang);
				return self.eval(json);
			}
		},
		global: self.global,
		json: true
	}, renderEnv);
	if(config && config.mount){
		var sub = libObject.getByKey(self.src, config.mount);
		utils.extend(sub, json);
	}else{
		utils.extend(self.src, json);
	}	
}
Disp.prototype.genProj = function(filelist, config){
	var self = this;
	self.genProjSub(filelist, {
		src: config.src,
		target: config.target,
		isPseudo: 1
	});
	self.genProjSub(filelist, {
		src: config.src,
		target: config.target
	});
}
Disp.prototype.genProjSub = function(filelist, config){
	var self = this;
	log.v("genProjSub");
  for (var orifilename in filelist){
    var partConfig = filelist[orifilename];
		if(libObject.isArray(partConfig)){
			for(var i in partConfig){
				self.genFilePre(path.join(config.target,orifilename), partConfig[i], config);
			}
		}else{
			self.genFilePre(path.join(config.target, orifilename), partConfig, config);
		}
  }
}
Disp.prototype.genFilePre = function(orifilename, partConfig, config){
	var self = this;
	log.v("genFilePre "+orifilename);
	if(orifilename.match(/\^\^.*\$\$/)){
		var env = self.getEnv(partConfig);
		var tfilename;
		var newPartConfig;
		if(!orifilename.match(/argv/)){
			tfilename = tmpl.render(orifilename, {global: env});
			newPartConfig = libObject.copy1(partConfig);
			if(partConfig.name)
				newPartConfig.name = tmpl.render(partConfig.name, {global: env});
			self.genFile(newPartConfig, tfilename, config);
		}else{
			if(typeof env != "object"){
				tfilename = tmpl.render(orifilename, {argv: env});
				newPartConfig = libObject.copy1(partConfig);
				if(partConfig.name)
					newPartConfig.name = tmpl.render(partConfig.name, {argv: env});
				self.genFile(newPartConfig, tfilename, config);
			}else{
				for(var key in env){
					var localenv = {
						argv: key, 
						env: env[key],
						global: self.global
					}
					tfilename = tmpl.render(orifilename, localenv);
					newPartConfig = libObject.copy1(partConfig);
					if(partConfig.name)
						newPartConfig.name = tmpl.render(partConfig.name, localenv);
					else
						newPartConfig.name = key;
					newPartConfig.env = libObject.copy1(env[key]);
					newPartConfig.env.argv = key;
					self.genFile(newPartConfig, tfilename, config);
				}
			}
		}
	}else{
		self.genFile(partConfig, orifilename, config);
	}

}
Disp.prototype.addStr = function(c, lang, deps){
	var self = this;
	var tmpstr = self.eval(c, lang, deps);
	return tmpstr || "";
}
Disp.prototype.genFile = function(partConfig, filename, config){
	var self = this;
	log.v("genFile "+filename);
	log.v(config);
	if(!partConfig.lang)
		partConfig.lang = "root";
	if(config.isPseudo == 1){
		if(partConfig.name){
			if(libObject.isArray(partConfig.name)){
				for(var i in partConfig.name){
					self.fileMap[partConfig.name[i]] = self.targetDir + "/" + filename;
				}
			}else{
				self.fileMap[partConfig.name] = self.targetDir + "/" + filename;
			}
		}
		return;
	}
	if(partConfig.arch){
		var dispConfig = {
			projectDir: self.projectDir + "/" + filename,
			targetDir: self.targetDir + "/" +filename,
			global: partConfig
		}
		if(partConfig.ignoreDispJson)
			dispConfig.ignoreDispJson = 1;
		if(partConfig.impl)
			dispConfig.global.impl = partConfig.impl;
		dispConfig.global.dev = self.global.dev;
		var tmpenv = self.getEnv(partConfig);
		for(var key in partConfig.global){
			var oldkey = partConfig.global[key];
			if(typeof oldkey == "string"){
				dispConfig.global[key] = libObject.getByKey(self.global, oldkey);
			}else{
				dispConfig.global[key] = self.global[key];
			}
		}
		if(tmpenv && !tmpenv._isGlobal)
			utils.extend(dispConfig.global, tmpenv);
		dispConfig.global.baseDir = self.projectDir;
		dispConfig.global.targetBaseDir = self.targetDir;
		var newDisp = new Disp(dispConfig, self.callback);
		newDisp.run();
	}
	if(partConfig.sub){
		self.genProjSub(partConfig.sub, {
			src: config.src,
			target: filename,
			isPseudo: config.isPseudo
		});
	}
	if(partConfig.sub || partConfig.arch){
		return;
	}
	log.i(filename);

	var env = self.getEnv(partConfig);
	var lang = partConfig.lang;
  var str = "";
	var deps = {};
	self.eval({init: 1}, lang, deps);

	if(partConfig.code){
		str += self.eval(partConfig.code, lang, deps);
	}
	if(partConfig.hasOwnProperty("content")){
		var c = partConfig.content;
		if(c){
			if(libObject.isArray(c)){
				for(var i in c){
					str += self.eval(env[c[i]], lang, deps);
				}
			}else{
				str += self.eval(env[c], lang, deps);
			}
		}else{
			str += self.eval(env, lang, deps);
		}
	}
	if(partConfig.export){
		var c = partConfig.export;
		if(libObject.isArray(c)){
			for(var i in c){
				str += self.eval({Lexport: self.global[c[i]]}, lang, deps);
			}
		}else{
			str += self.eval({Lexport: self.global[c]}, lang, deps);
		}
	}


	if(!env._isGlobal){
		env.main = str;
	}
	env.global = self.global;
	if(partConfig.raw){
		str += tmpl.render(partConfig.raw, env);
	}

	if(partConfig.tmpl || partConfig.src){
		var evalFunc = function(json2, lang2, pseudoFlag){
			if(lang2) return self.eval(json2, lang2, deps, pseudoFlag);
			return self.eval(json2, lang, deps, pseudoFlag);
		}
		env.extend = {eval: evalFunc};
		var srcfile;
		if(partConfig.tmpl)
			srcfile = config.src + "/" + partConfig.tmpl;
		else if(partConfig.src)
			srcfile = self.projectDir + "/" + partConfig.src;
		env.deps = deps;
		str = tmpl.render({
			file: srcfile
		}, env);
		delete env.deps;
	}

//	parse deps 

	var gdeps = {};
	self.expandDeps(deps, gdeps, partConfig);
	var parseDeps = [];
	var fileArgv = {};
	for(var key in gdeps){
		if(gdeps[key].isArgv){
			fileArgv[key] = gdeps[key];
		}else if(gdeps[key].files){
			for(var i in gdeps[key].files){
				var tmp = gdeps[key].files[i];
				if(gdeps[key].vendor) tmp.vendor = 1;
				tmp.name = key;
				parseDeps.push(tmp);
			}
		}else{
			parseDeps.push(gdeps[key]);
		}
	}
	var tfilename = self.targetDir + "/" + filename;

	str = self.eval({
		file: fileArgv,
		deps: parseDeps,
		main: str,
		fullpath: tfilename,
		lib: partConfig.lib,
		addExport: function(key, lib, reqconfig){
			self.addExport(key, lib, reqconfig);
		}
	}, lang, {});
	if(config.isPseudo){
		return;
	}
  libFile.mkdirpSync(path.dirname(tfilename)); //to be acc
  if(fs.existsSync(tfilename))
    fs.unlinkSync(tfilename);
	self.fileCount ++;
	var mode;
	if(partConfig.exec){
		mode = 0555;
		str = "#!/usr/bin/env "+ partConfig.exec + "\n" + str;
	}else{
		mode = 0444;
	}
  fs.writeFileSync(tfilename, str, {mode: mode});
	self.eval({finish: 1}, lang, gdeps);
}

Disp.prototype.genPlugin = function(){
	var self = this;
	//file struct
	for(var plugin in self.global.plugins){
		var configFile = self.global.pluginDir + "/" + plugin;
		var tmp;
		try {
			tmp = require(configFile);
		}catch(e){
			self.callback(e);
		}
		self.genProj(tmp, {
			src: configFile,
			target: self.target || ""
		});
	}
}
Disp.prototype.getEnv = function(partConfig){
	var self = this;
	var env;
	if(partConfig.env){
		env = partConfig.env;
	}else if(partConfig.envkey){
		env = libObject.getByKey(self.global, partConfig.envkey);
		partConfig.env = env;
	}else
		env = self.global;
	if(!env) env = {};
	return env;
}


// simple methods
Disp.prototype.expandDeps = function(deps, gdeps, partConfig){
	var self = this;
	var lang = partConfig.lang;
	var vendors = self.eval({"vendor.json": 1}, lang);
	for(var key in deps){
		var vendorConfig = vendors[key];
		if(vendorConfig && vendorConfig.deps){
			self.expandDeps(vendorConfig.deps, gdeps, partConfig);
		}
		var langConfig = self.getDepConfig(key, lang, deps[key]);
		if(!partConfig.lib && langConfig && langConfig.deps){
			self.expandDeps(langConfig.deps, gdeps, partConfig);
		}
		if(!gdeps[key]){
			gdeps[key] = {};
		}
		if(vendorConfig){
			if(!gdeps[key].vendor){
				utils.extend(gdeps[key], vendorConfig);
			}
			gdeps[key].vendor = 1;
		}
		if(langConfig){
			utils.extend(gdeps[key], langConfig);
		}
		if(typeof deps[key] !="object")
			gdeps[key].val = deps[key];
		else
			utils.extend(gdeps[key], deps[key]);
	}
}
Disp.prototype.addExport = function(key, lib, reqconfig){
	var self = this;
	if(typeof lib == "string"){
		var name = lib;
		reqconfig.file = self.fileMap[name];
		reqconfig.sub = key;
		var toextend = {};
		toextend[name] = {};
		toextend[name][key]= {lib: key};
		utils.extend(self.global, toextend);
	}
}

var cache = {};
Disp.prototype.getDepConfig = function(key, lang, val){
	var self = this;
	var rtn = {};
//local file
	if(self.fileMap[key]){
		rtn.file = self.fileMap[key];
	}else{
//local lib			
		var evaljson = {};
		evaljson[key+".lib"] =1;
		var deps = {};
		if(self.eval(evaljson, lang, deps, true)){
			rtn.lib = key;
			rtn.deps = deps;
		}
//remote lib
		else {
			var toext = {
        _packages: {}
      }
			toext._packages[key] = val;
			libObject.extend(self.global, toext);
			rtn.pkg = key;
		}
	}
	rtn.name = key;

	return rtn;
}
*/
Disp.prototype.dispose = function(){
	var self = this;
//	console.log(self);
/*
	if(self.global._isRoot)
		fs.writeFileSync(
			self.projectDir + "/global.json", 
			JSON.stringify(self.global, function(key, value){
				if(key == "local" 
					 || key == "global" 
					 || key == "origin" 
					 || key[0] == "_")
					return undefined;
				else
					return value;
			}, 2)
		);
	log.i(self.fileCount + " files updated");
*/
	log.v("dispose success");
}
