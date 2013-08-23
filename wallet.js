var sx = require('./sxlib.js'),
    _ = require('underscore'),
    async = require('async'),
    eh = sx.eh;

module.exports = function(wallet,cb,cbdone) {
    if (typeof wallet === "string") { wallet = { seed: wallet } }
    wallet.recv = wallet.recv || [];
    wallet.change = wallet.change || [];
    wallet.special = wallet.special || [];
    wallet.utxo = wallet.utxo || [];
    wallet.stxo = wallet.stxo || [];
    wallet.n = wallet.n || 5;
    wallet.update = wallet.update || function(){};
    wallet.last_recv_load = 0;
    wallet.last_change_load = 0;
    wallet.ready = false;

    cb = cb || function(){};
    cbdone = cbdone || function(){};

    var txouniq = function(arr) { return _.uniq(arr,false,function(x) { return x.output; }); }
    var reload_interval;

    wallet.refresh = function() {
        wallet.lastAccessed = new Date().getTime();
        if (!reload_interval) {
            reload_interval = setInterval(_.partial(wallet.reload,function(){}),10000);
        }
    }
    console.log("Seed:",wallet.seed);

    var update_txoset = function(h) {
        var utxo = h.filter(function(x) { return !x.spend });
        var stxo = h.filter(function(x) { return x.spend });
        wallet.stxo = txouniq(wallet.stxo.concat(stxo));
        var stxids = wallet.stxo.map(function(x) { return x.output; });
        var addrs = wallet.recv.concat(wallet.change).map(function(x) { return x.addr; });
        wallet.utxo = txouniq(utxo.concat(wallet.utxo))
            .filter(function(x) {
                return stxids.indexOf(x.output) == -1 && addrs.indexOf(x.address) >= 0;
             });
    }

    async.series([function(cb2) {
        console.log("Loading change addresses...");
        sx.cbuntil(function(cb2) {
            sx.genpriv(wallet.seed,wallet.change.length,1,eh(cb,function(key) {
                console.log(key);
                sx.gen_addr_data(key,eh(cb,function(data) {
                    wallet.change.push(data);
                    sx.history(data.addr,eh(cb,function(h) {
                        if (h.length > 0) {
                            update_txoset(h);
                            return cb2(null,false);
                        }
                        return cb2(null,true);
                    }));
                }));
            }));
        },cb2);
    },function(cb2) {
        console.log("Loaded " + wallet.change.length + " change addresses");
        console.log("Loading receiving addresses");
        var old_recv_length = wallet.recv.length;
        sx.cbmap(_.range(wallet.recv.length,wallet.n),function(i,cb3) {
            sx.genpriv(wallet.seed,i,0,eh(cb3,function(pk) {
                sx.gen_addr_data(pk,cb3);
            }));
        },eh(cb2,function(data) {
            console.log("Have " + wallet.n + " receiving addresses (" + (wallet.n-old_recv_length) + " new)");
            console.log("Loading history");
            wallet.recv = wallet.recv.concat(data);
            sx.history(wallet.recv.map(function(x) { return x.addr; }),eh(cb2,function(h) {
                update_txoset(h);
                cb2(null,true);
            }));
        }));
    },function(cb2) {
        console.log("Wallet ready");
        wallet.refresh();
        wallet.ready = true;
        cbdone(null,wallet);
    }]);


    
    wallet.getaddress = function(change,cb2) {
        wallet.refresh();
        if (typeof change == "function") {
            cb2 = change; change = false;
        }
        sx.genpriv(wallet.seed,wallet.recv.length,change ? 1 : 0,eh(cb2,function(priv) {
            sx.gen_addr_data(priv,eh(cb2,function(data) {
                if (!change) {
                    wallet.n++;
                    wallet.recv.push(data);
                    wallet.update();
                }
                else { wallet.change.push(data); }
                cb2(null,data);
            }));
        }));
    }

    wallet.getmultiaddress = function(other,k,cb2) {
        wallet.refresh();
        sx.genpriv(wallet.seed,wallet.recv.length,0,eh(cb2,function(priv) {
            sx.genpub(priv,eh(cb2,function(pub) {
                sx.gen_multisig_addr_data([pub].concat(other),k,eh(cb2,function(data) {
                    data.pks = [priv];
                    wallet.special.push(data);
                    cb2(null,data);
                }));
            }));
        }));
    }

    wallet.reload = function(cb2) {
        var recv = wallet.recv.map(function(x) { return x.addr; });
        var change = wallet.change.map(function(x) { return x.addr; });
        cb2 = cb2 || function(){}

        if (new Date().getTime() - wallet.lastAccessed > 600000) {
            clearInterval(reload_interval);
            reload_interval = null;
        }

        sx.history(recv.concat(change),eh(cb2,function(h) {
            update_txoset(h);
            wallet.update()
            cb2(null,wallet);
        }));
    }

    wallet.mk_signed_transaction = function(to,value,cb2) {
        wallet.refresh();
        sx.get_enough_utxo_from_history(wallet.utxo,value+10000,eh(cb2,function(utxo) {
            var lastaddr = wallet.change[wallet.change.length-1].addr;
            sx.make_sending_transaction(utxo,to,value,lastaddr,eh(cb2,function(tx) {
                sx.sign_tx_inputs(tx,wallet.recv.concat(wallet.change),wallet.utxo,eh(cb2,function(stx) {
                    return cb2(null,{
                        utxo: utxo,
                        tx: stx
                    });
                }));
            }));
        }));
    }

    wallet.push_signed_transaction = function(tx, usedtxo, cb2) {
        sx.showtx(tx,eh(cb2,function(shown) {
            shown.outputs.map(function(o) { delete o.script });
            var usedtxids = usedtxo.map(function(x) { return x.output });
            var addrs = wallet.recv.concat(wallet.change)
                .map(function(x) { return x.addr });
            wallet.utxo = wallet.utxo
                .concat(shown.outputs)
                .filter(function(x) {
                    return usedtxids.indexOf(x.output) == -1 && addrs.indexOf(x.address) >= 0;
                })
            wallet.stxo = txouniq(wallet.stxo.concat(usedtxo));
            wallet.reload();
            console.log('broadcasting: ',tx);
            sx.validtx(tx,eh(cb2,function(v) {
                console.log(v);
                sx.broadcast(tx,eh(cb2,function() {}));
                wallet.getaddress(true,eh(cb2,function(data) {
                    cb2(null,tx);
                }));
            }));
        }));
    }

    wallet.send = function(to, value, cb2) {
        wallet.mk_signed_transaction(to,value,eh(cb2,function(obj) {
            wallet.push_signed_transaction(obj.tx,obj.utxo,cb2);
        }));
    }

    cb(null,wallet);
}

