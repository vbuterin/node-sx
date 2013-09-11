var sx              = require('./sxlib.js'),
    electrum_wallet = require('./wallet.js'),
    eto             = require('./eto.js');
    Db              = require('mongodb').Db,
    Connection      = require('mongodb').Connection,
    Server          = require('mongodb').Server,
    BSON            = require('mongodb').BSON,
    ObjectID        = require('mongodb').ObjectID,
    express         = require('express'),
    crypto          = require('crypto'),
    async           = require('async'),
    base32          = require('thirty-two'),
    notp            = require('notp'),
    _               = require('underscore'),
    sha256          = function(x) { return crypto.createHash('sha256').update(x).digest('hex') },
    slowsha         = function(x) {
                          var old_pass = x, new_pass;
                          for (var i = 0; i < 10000; i++) {
                              new_pass = crypto.createHash('sha256').update(old_pass).digest('hex');
                              old_pass = new_pass + x;
                          }
                          return new_pass;
                      },
    eh              = sx.eh;

module.exports = function() {

    var host = process.env['MONGO_NODE_DRIVER_HOST'] != null ? process.env['MONGO_NODE_DRIVER_HOST'] : 'localhost';
    var port = process.env['MONGO_NODE_DRIVER_PORT'] != null ? process.env['MONGO_NODE_DRIVER_PORT'] : Connection.DEFAULT_PORT;

    var db = new Db('nodesx-wal', new Server(host, port), {safe: false}, {auto_reconnect: true}, {});


    var Wallet,
        Config, 
        config,
        Twofactor,
        entropy;

    db.open(function(err,dbb) {
        if (err) { throw err; }
        db = dbb;
        sx.cbmap(['wallet','config','twofactor'],function(nm,cb2) {
            db.collection(nm,function(err,collection) { 
                if (err) { throw err; }
                cb2(null,collection);
            }); 
        },function(err,o,cb) {
            if (err) { throw err; }
            Wallet = o[0];
            Config = o[1];
            Twofactor = o[2];
            Config.findOne({},function(err,cf) {
                if (err) { throw err; }
                config = cf || {};
            });
        });
    });

    crypto.randomBytes(100,function(err,buf) {
        if (err) { throw err; }
        entropy = buf.toString('hex');
    });

    var random = function(modulus) {
        var alphabet = '0123456789abcdef';
        return sha256(entropy+new Date().getTime()+Math.random()).split('')
               .reduce(function(tot,x) {
                    return (tot * 16 + alphabet.indexOf(x)) % modulus;
               },0);
    }

    var app = express();

    app.configure(function(){                                                                 
         app.set('views',__dirname + '/views');                                                  
         app.set('view engine', 'jade'); app.set('view options', { layout: false });             
         app.use(express.bodyParser());                                                          
         app.use(express.methodOverride());                                                      
         app.use(app.router);                                                                    
         app.use(express.static(__dirname + '/public'));                                         
    });

    var active_wallets = {};

    var update_int = setInterval(function() {
        for (var v in active_wallets) {
            var w = active_wallets[v];
            w.update_history(function() {
                //console.log("Saving wallet...");
                Wallet.update({name: w.name},w,function(){});
            });
        }
    },10000);

    var mkrespcb = function(res,code,success) {
        return eh(function(e) { res.json(e,code); },success);
    }

    var retrieve = function(name,pw,cb) {
        if (active_wallets[name]) { 
            if (pw == active_wallets[name].pw) {
                 return cb(null,active_wallets[name]);
            }
            else { return cb("Bad password"); }
        }       
        Wallet.findOne({ name: name },eh(cb,function(w) {
            if (w) {
                if (pw == w.pw) { 
                    electrum_wallet(w,null,eh(cb,function(w2) {
                        cb(null,w2); 
                    }));
                }
                else { cb("Bad password"); }
            }
            else { cb(null,null); }
        }));
    }

    var hard_retrieve = function(req,cb) {
        var name = ""+req.param("name"),
            pw = sha256(""+req.param("pw"));
        retrieve(name,pw,eh(cb,function(w) { w ? cb(null,w) : cb("No wallet") }));
    }

    var smartParse = function(x) {
        return (typeof x == "string") ? JSON.parse(x) : x;
    }

    app.use('/get',function(req,res) {
        var seed = sha256(""+req.param("name")+":"+req.param("pw")).substring(0,32),
            name = ""+req.param("name"),
            pw = sha256(""+req.param("pw"));

        retrieve(name,pw,mkrespcb(res,400,function(w) {
            if (w) {
                active_wallets[w.name] = w;
                if (req.param('reload')) {
                    console.log('Force reloading');
                    w.update_history(mkrespcb(res,400,function() {
                        console.log("Finished loading: ",w);
                        return res.json(w); 
                    }));
                }
                else return res.json(w); 
            }
            else electrum_wallet(seed,null,mkrespcb(res,400,function(w) {
                w.name = name;
                w.pw = pw;
                Wallet.insert(w,mkrespcb(res,400,function(w2) {
                    active_wallets[w.name] = w;
                    console.log("Finished loading: ",w);
                    res.json(w);
                }));
            }));
        }));
    });
    app.use('/addr',function(req,res) {
        hard_retrieve(req,mkrespcb(res,400,function(w) {
            w.getaddress(mkrespcb(res,400,function(address) {
                return res.json(address);
            }));
        }));
    });
    app.use('/reset',function(req,res) {
        hard_retrieve(req,mkrespcb(res,400,function(w) {
            Wallet.remove({ name: w.name },mkrespcb(res,400,function() {
                delete active_wallets[w.name];
                electrum_wallet({
                    seed: w.seed,
                    name: w.name,
                    pw: w.pw,
                    n: w.n,
                    special: w.special
                },null,mkrespcb(res,400,function(w2) {
                    active_wallets[w.name] = w2;
                    res.json(w2);
                }));
            }));
        }));
    });
    var send = function(req,res) {
        var name = ""+req.param("name"),
            pw = sha256(req.param("pw")),
            to = req.param("to"),
            value = Math.ceil(parseFloat(req.param("value"))*100000000);
        retrieve(name,pw,mkrespcb(res,400,function(w) {
            if (!w) { 
                return res.json("Wallet not found"); 
            }
            w.send(to,value,mkrespcb(res,400,function(tx) {
                return res.json(tx);
            }));
        }));
    }
    app.use('/send',send);
    app.post('/send',send);

    var getreqpubs = function(req) {
        var pubs = [];
        req.query = _.extend(req.query,req.body)
        for (var v in req.query) {
            if (v.substring(0,3) == "pub") {
                if (req.query[v].length == 66 || req.query[v].length == 130) {
                    pubs.push(req.query[v]); 
                }
                else if (req.query[v]) {
                    return { error: "Bad pubkey: "+req.query[v] }
                }
            }
        }
        return pubs;
    }

    app.use('/msigaddr',function(req,res) {
        req.query = _.extend(req.query,req.body)
        var pubs = getreqpubs(req);
        if (pubs.error) {
            return res.json(pubs.error,400);
        }
        var k = parseInt(req.param("k"));
        if (isNaN(k)) {
            return res.json("Invalid k: "+k,400); 
        }
        console.log("Generating multisig address from "+k+" of: ",pubs)
        sx.gen_multisig_addr_data(pubs,k,mkrespcb(res,400,function(d) {
            res.json(d);
        }));
    });

    app.use('/showtx',function(req,res) {
        sx.showtx(req.param('tx'),mkrespcb(res,400,_.bind(res.json,res)));
    });

    app.use('/genaddrdata',function(req,res) {
        crypto.randomBytes(32,mkrespcb(res,400,function(buf) {
            var hexpk = buf.toString('hex');
            sx.base58check_encode(hexpk,128,mkrespcb(res,400,function(pk) {
                sx.gen_addr_data(pk,mkrespcb(res,400,function(addrdata) {
                    res.json(addrdata);
                }));
            }));
        }));
    });

    app.use('/brainwallet',function(req,res) {
        var seed = req.param('name') ? req.param('name') + ':' + req.param('pw')
                                     : req.param('pw');
        var pw = slowsha(seed);
        if (req.param('style') == 'electrum') {
            res.json(pw.substring(0,32));
        }
        else {
            sx.base58check_encode(pw,128,mkrespcb(res,400,function(pk) {
                sx.gen_addr_data(pk,mkrespcb(res,400,function(addrdata) {
                    res.json(addrdata);
                }));
            }));
        }
    });

    app.use('/privtopub',function(req,res) {
        sx.pubkey(req.param('pk'),mkrespcb(res,400,_.bind(res.json,res)));
    });

    app.use('/addrtopub',function(req,res) {
        sx.addr_to_pubkey(req.param('address'),mkrespcb(res,400,_.bind(res.json,res)));
    });

    app.use('/sigs',function(req,res) {
        var inp = req.param('tx') ||  smartParse(req.param('eto'));
        eto.extract_signatures(inp,mkrespcb(res,400,_.bind(res.json,res)));
    });

    app.use('/toaddress',function(req,res) {
        var inp = req.param('pub') || req.param('pk') || req.param('script');
        sx.toaddress(inp,mkrespcb(res,400,_.bind(res.json,res)));
    });

    app.use('/mkmultitx',function(req,res) {
        var from   = req.param('from'),
            to     = req.param('to'),
            script = req.param('script'),
            value  = Math.ceil(parseFloat(req.param('value')) * 100000000);
        async.waterfall([function(cb2) {
            if (from.length > 34) {
                sx.fetch_transaction(utxoid.substring(0,64),eh(cb2,function(tx) {
                    sx.showtx(tx,eh(cb2,function(shown) {
                        return cb2(null,[shown.outputs[parseInt(utxoid.substring(65))]]);
                    }));
                }));
            }
            else if (from) {
                sx.get_utxo(from,value+10000,cb2);
            }
            else { return cb2("Need from or utxo"); }
        }, function(utxo,cb2) {
            console.log("Making transaction sending "+value+" satoshis to "+to);
            console.log("UTXO:",utxo);
            sx.make_sending_transaction(utxo,to,value,utxo[0].address,eh(cb2,function(tx) {
                cb2(null,tx,utxo);
            }));
        }, function(tx,utxo,cb2) {
            var scriptmap = {};
            scriptmap[utxo[0].address] = script;
            eto.mketo(tx,scriptmap,utxo,cb2);
        }],mkrespcb(res,400,_.bind(res.json,res)));
    });

    app.use('/mketo',function(req,res) {
        var tx = req.param('tx'),
            sm = {};
        req.query = _.extend(req.query,req.body)
        for (var p in req.query) {
            if (27 <= p.length <= 34) { sm[p] = req.query[p]; }
        }
        eto.mketo(tx,sm,null,mkrespcb(res,400,_.bind(res.json,res)));
    });

    app.use('/signeto',function(req,res) {
        try {
            var eto_object = smartParse(req.param('eto')),
                pk = req.param('privkey') || req.param('pk');
        }
        catch(e) { 
            return res.json("Failed to JSON parse: "+req.param("eto"),400); 
        }
        console.log('s1',pk,eto_object);
        eto.signeto(eto_object,pk,mkrespcb(res,400,_.bind(res.json,res)));
    });

    app.use('/applysigtoeto',function(req,res) {
        try {
            var eto_object = smartParse(req.param('eto')),
                sig = req.param('sig'),
                sigs = smartParse(req.param('sigs'));
        }
        catch(e) { 
            return res.json("Failed to JSON parse: "+req.param("eto"),400); 
        }
        if (sig) { 
            eto.apply_sig_to_eto(eto_object,sig,mkrespcb(res,400,_.bind(res.json,res)));
        }
        else if (sigs) {
            sx.foldr(sigs,eto_object,eto.apply_sig_to_eto,mkrespcb(res,400,_.bind(res.json,res)));
        }
        else res.json(eto_object);
    });
    
    app.use('/pusheto',function(req,res) {
        try {
            var eto_object = smartParse(req.param('eto'));
        }
        catch(e) { 
            return res.json("Failed to JSON parse: "+req.param("eto"),400); 
        }
        eto.publish_eto(eto_object,mkrespcb(res,400,_.bind(res.json,res)));
    });

    app.use('/history',function(req,res) {
        console.log('grabbing',req.param('address'));
        sx.history(req.param('address'),mkrespcb(res,400,function(h) {
            console.log('grabbed');
            if (req.param('unspent')) {
                h = h.filter(function(x) { return !x.spend });
            }
            if (req.param('confirmations')) {
                h = h.filter(function(x) { return x.confirmations >= parseInt(req.param('confirmations')) });
            }
            return res.json(h);
        }));
    });

    app.use('/addr_to_pubkey_or_script',function(req,res) {
        sx.addr_to_pubkey(req.param('address'),mkrespcb(res,400,function(result) {
            return res.json(result);
        }));
    });

    var b32_alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    var genkey = function() {
        return _.range(16).map(function() {
            return b32_alphabet[random(32)];
        }).join('');
    }

    var verifykey = function(otp,key) {
        binkey = base32.decode(key)
                       .split('')
                       .map(function(x) { return x.charCodeAt(0) });
        // Check against previous, current and next TOTP key
        return notp.totp.verify(otp,binkey,{ window: 1 }); 
    }

    app.use('/reset',function(req,res) {
        var pubs = getreqpubs(req),
            k = parseInt(req.param("k") || 2),
            oldkey = req.param("oldkey"),
            name = req.param("name"),
            key = genkey();


        if (pubs.error) {
            return res.json(pubs.error,400);
        }
        async.waterfall([function(cb) {
            if (pubs.length > 0) {
                pubs.push(config.pub);
                sx.gen_multisig_addr_data(pubs,k,mkrespcb(res,400,function(addrdata) {
                    cb({ key: key, addrdata: addrdata });
                }));
            }
            else cb({ key: key });
        },function(updatedict,cb) {
            Twofactor.findOne({ name: name },eh(cb,function(tf) {
                if (oldkey != tf.key) {
                    return cb("Error: need to enter correct OTP secret to reset it");
                }
                Twofactor.update({ name: name },updatedict,cb);
            }));
        }],mkrespcb(res,400,function(data) {
            console.log('updating_acct',data);
            res.json(data);
        }));
    });

    app.use('/register',function(req,res) {
        console.log('Attempting registration or login');
        var name = req.param('name'),
            pubs = getreqpubs(req),
            k = parseInt(req.param("k") || 2);
        if (pubs.error) {
            return res.json(pubs.error,400);   
        }
        if (pubs.length == 0) {
            return res.json("Need at least one pubkey!",400);
        }
        pubs = [config.pub].concat(pubs);
        Twofactor.findOne({ name: name },mkrespcb(res,400,function(tf) {
            if (tf && tf.verified) {
                var sameAccount = true;
                if (k != tf.addrdata.k) {
                    sameAccount = false;
                }
                // TODO
                /*// Use the user-provided pubkey as the equivalent of a hashed
                // password; obviously easily breakable, but this just protects
                // against accidental login errors
                for (var i = 0; i < pubs.length; i++) {
                    if (tf.addrdata.pubs.indexOf(pubs[i]) == -1) {
                        console.log(pubs[i],tf.addrdata.pubs);
                        sameAccount = false;
                    }
                }*/
                if (!sameAccount) {
                    return res.json("Account exists, incorrect data",400);
                }
                return res.json({
                    verified: true,
                    name: name,
                    addrdata: tf.addrdata
                });
            }
            else {
                var key = genkey();
                sx.gen_multisig_addr_data(pubs,k,mkrespcb(res,400,function(addrdata) {
                    var insert = function(d,cb) { 
                        // We can rewrite accounts that have not been 2FA-verified
                        console.log(tf ? "Exists" : "Doesn't exist");
                        if (tf) Twofactor.update({ name: name },d,cb); 
                        else Twofactor.insert(d,cb);
                    }
                    var obj = {
                        name: name,
                        key: key,
                        verified: false,
                        addrdata: addrdata
                    };
                    insert(obj,mkrespcb(res,400,function() {
                        console.log(tf ? 'rewrittenacct' : 'newacct',obj);
                        res.json(obj);
                    }));
                }));
            }
        }));
    });

    app.use('/validate',function(req,res) {
        var name = req.param("name"),
            otp = req.param("otp");
        Twofactor.findOne({ name: name },mkrespcb(res,400,function(tf) {
            if (!tf) {
                return res.json("Account not found",400);
            }
            if (!verifykey(otp,tf.key)) {
                return res.json("Verification failed",400);
            }
            tf.verified = true;
            Twofactor.update({ name: name },tf,mkrespcb(res,400,function(a) {
                res.json("Verification successful");
            }));
        }));
    });

    app.use('/admin',function(req,res) {
        var pw = req.param('pw'),
            priv = req.param('priv'),
            fee = req.param('fee'),
            read = req.param('read'),
            feeaddress = req.param('feeaddress');
        if (!pw) {
            return res.json("No password provided",403);
        }
        if (slowsha(pw) != 'd82477f0daac66f152012dd14d63000d5cd63eb4ad9f7e760e492e3cf49be7d4') {
            return res.json("Bad password",403);
        }
        if (read) {
            Config.findOne({},mkrespcb(res,400,_.bind(res.json,res)));
        }
        sx.gen_addr_data(priv,mkrespcb(res,400,function(addrdata) {
            config.priv = addrdata.priv;
            config.pub = addrdata.pub;
            config.feeaddress = feeaddress;
            config.fee = fee;
            Config.findOne({},mkrespcb(res,400,function(c) {
                var cb = mkrespcb(res,400,_.bind(res.json,res));
                if (!c) { Config.insert(config,cb) }
                else { 
                    Config.update({},config,cb);
                }
            }));
        }));
    });

    app.use('/2fasign',function(req,res) {
        var name = req.param("name"),
            otp = req.param("otp"),
            tx = req.param("tx"),
            eto_object = req.param("eto");
        Twofactor.findOne({ name: name },mkrespcb(res,400,function(tf) {
            if (!tf) { 
                res.json("Name not found",400);
            }
            else if (!verifykey(otp,tf.key)) {
                res.json("Verification failed",400);
            }
            else {
                async.waterfall([function(cb) {
                    if (eto_object) {
                        if (typeof eto_object == "string") {
                            try {
                                eto_object = JSON.parse(eto_object);
                            }
                            catch(e) { return cb(e); }
                        }
                        cb(null,eto_object);
                    }
                    else {
                        var sm = {}
                        sm[tf.addrdata.address] = tf.addrdata.raw;
                        eto.mketo(tx,sm,null,cb);
                    }
                },function(eto_object,cb) {
                    eto.signeto(eto_object,config.priv,cb);
                }],mkrespcb(res,400,_.bind(res.json,res)));
            }
        }));
    });

    app.use('/wallet',function(req,res) {                                                           
        res.render('wallet.jade',{});                                                           
    });

    app.use('/multigui',function(req,res) {                                                           
        res.render('multigui.jade',{});                                                           
    });

    app.use('/2fawallet',function(req,res) {                                                           
        res.render('2fawallet.jade',{});                                                           
    });

    app.listen(3191);

    return app;
};

