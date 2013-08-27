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
    var txodiff = function(arr1,arr2) {
        var del_outputs = arr2.map(function(x) { return x.output });
        return arr1.filter(function(x) { return del_outputs.indexOf(x.output) == -1 });
    }

    wallet.update_txoset = function(h) {
        var origt = wallet.stxo.length+" "+wallet.utxo.length;

        var addrs = wallet.recv.concat(wallet.change).map(function(x) { return x.address; });
        h = h.filter(function(x) { return addrs.indexOf(x.address) >= 0 });

        var utxo = h.filter(function(x) { return !x.spend });
        var stxo = h.filter(function(x) { return x.spend });
        //console.log('u',utxo,'s',stxo);

        wallet.stxo = txouniq(wallet.stxo.concat(stxo));
        wallet.utxo = txodiff(txouniq(utxo.concat(wallet.utxo)),wallet.stxo)

        return wallet.stxo.length+" "+wallet.utxo.length != origt;
    }

    wallet.update_change_addresses = function(cb2) {
        console.log("Loading change addresses...");
        var original_change_length = wallet.change.length;
        sx.cbuntil(function(cb2) {
            sx.genpriv(wallet.seed,wallet.change.length,1,eh(cb,function(key) {
                console.log(key);
                sx.gen_addr_data(key,eh(cb,function(data) {
                    wallet.change.push(data);
                    sx.history(data.address,eh(cb,function(h) {
                        cb2(null,h.length == 0);
                    }));
                }));
            }));
        },eh(cb2,function() { 
            var n = wallet.change.length - original_change_length;
            console.log("Loaded "+n+" new change addresses");
            cb2(null,n>0);
        }));
    }

    wallet.load_receiving_addresses = function(cb2) {
        console.log("Loading receiving addresses");
        var old_recv = wallet.recv;
        sx.cbmap(_.range(old_recv.length,wallet.n),function(i,cb3) {
            sx.genpriv(wallet.seed,i,0,eh(cb3,function(pk) {
                sx.gen_addr_data(pk,cb3);
            }));
        },eh(cb2,function(data) {
            wallet.recv = old_recv.concat(data);
            var newadds = wallet.n - old_recv.length;
            console.log("Have " + wallet.n + " receiving addresses (" + newadds + " new)");
            cb2(null,newadds > 0);
        }));
    }

    wallet.update_history = function(cb2) {
        console.log("Updating history");
        var recv = wallet.recv.map(function(x) { return x.address; });
        var change = wallet.change.map(function(x) { return x.address; });
        cb2 = cb2 || function(){}
        sx.history(recv.concat(change),eh(cb2,function(h) {
            var changed = wallet.update_txoset(h);
            console.log("History " + changed ? "updated" : "unchanged");
            cb2(null,changed);
        }));
    }

    wallet.full_update = function(cb2) {
        async.series([
            wallet.update_change_addresses,
            wallet.load_receiving_addresses,
            wallet.update_history
        ],cb2);
    }
    
    wallet.getaddress = function(change,cb2) {
        if (typeof change == "function") {
            cb2 = change; change = false;
        }
        sx.genpriv(wallet.seed,wallet.recv.length,change ? 1 : 0,eh(cb2,function(priv) {
            sx.gen_addr_data(priv,eh(cb2,function(data) {
                if (!change) {
                    wallet.n++;
                    wallet.recv.push(data);
                }
                else { wallet.change.push(data); }
                cb2(null,data);
            }));
        }));
    }


    wallet.mk_signed_transaction = function(to,value,cb2) {
        sx.get_enough_utxo_from_history(wallet.utxo,value+10000,eh(cb2,function(utxo) {
            var lastaddr = wallet.change[wallet.change.length-1].address;
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

            var update_txo = function() {
                shown.outputs.map(function(o) { delete o.script });
                var usedtxids = usedtxo.map(function(x) { return x.output });
                var addrs = wallet.recv.concat(wallet.change)
                    .map(function(x) { return x.address });
                wallet.utxo = wallet.utxo
                    .concat(shown.outputs)
                    .filter(function(x) {
                        return usedtxids.indexOf(x.output) == -1 && addrs.indexOf(x.address) >= 0;
                    })
                wallet.stxo = txouniq(wallet.stxo.concat(usedtxo));
            }

            console.log('broadcasting: ',tx);

            var done = _.once(function(tx) {
                wallet.getaddress(true,eh(cb2,function(data) {
                    sx.txhash(tx,eh(cb2,function(hash) {
                        cb2(null,hash);
                    }));
                }));
            });
            sx.validtx(tx,eh(cb2,function(v) {
                if (sx.jsonfy(v).Status == "Success") {
                    update_txo();
                }
                console.log(v);
                sx.broadcast(tx,eh(cb2,function() {}));
                done(tx);
            }));
            /*sx.bci_pushtx(tx,eh(cb2,function(ans) {
                console.log(ans);
                done(tx);
            }));*/
        }));
    }

    wallet.send = function(to, value, cb2) {
        console.log("Attempting to send "+value+" satoshis to "+to);
        wallet.mk_signed_transaction(to,value,eh(cb2,function(obj) {
            wallet.push_signed_transaction(obj.tx,obj.utxo,cb2);
        }));
    }

    cb(null,wallet);
    wallet.full_update(eh(cbdone,function() { cbdone(null,wallet); }));
}

