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
    wallet.postprocess = wallet.postprocess || function(){};
    wallet.last_recv_load = 0;
    wallet.last_change_load = 0;
    wallet.ready = false;

    cb = cb || function(){};
    cbdone = cbdone || function(){};

    wallet.actionqueue = [];
    wallet.locked = false;

    var queuewrapper = function(f) {
        var callback = arguments[arguments.length-1],
            front = Array.prototype.slice.call(arguments,0,arguments.length-1);
        var smartcb = function(err,res) {
            if (wallet.actionqueue.length === 0) {
                wallet.locked = false;
                return cb(err,res); 
            }
            else {
                var first = wallet.actionqueue.splice(0,1)[0],
                    fn = first[0],
                    args = first.slice(1);
                fn.apply(wallet,args);
            }
        }
        return function() {
            if (wallet.locked) {
                wallet.actionqueue.push([f].concat(front.concat([smartcb])));   
            }
            else {
                wallet.locked = true;
                f.apply(wallet,front.concat([smartcb]));
            }
        }
    }

    var txouniq = function(arr) { return _.uniq(arr,false,function(x) { return x.output; }); }
    var txodiff = function(arr1,arr2) {
        var del_outputs = arr2.map(function(x) { return x.output });
        return arr1.filter(function(x) { return del_outputs.indexOf(x.output) == -1 });
    }
    var txoIsMine = function(txo) {
        var v = wallet.recv.concat(wallet.change);
        for (var i in v) { if (txo.address == v[i].address) { return true; } }
        return false;
    }

    wallet.update_txoset = function(h) {
        var origt = wallet.stxo.length+" "+wallet.utxo.length;

        h = h.filter(txoIsMine);

        var utxo = h.filter(function(x) { return !x.spend });
        var stxo = h.filter(function(x) { return x.spend });
        //console.log('u',utxo,'s',stxo);

        wallet.stxo = txouniq(wallet.stxo.concat(stxo));
        wallet.utxo = txodiff(txouniq(utxo.concat(wallet.utxo)),wallet.stxo)

        return wallet.stxo.length+" "+wallet.utxo.length != origt;
    }

    wallet.update_change_addresses = queuewrapper(function(cb2) {
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
    })

    wallet.load_receiving_addresses = queuewrapper(function(cb2) {
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
    })

    wallet.update_history = queuewrapper(function(cb2) {
        console.log("Updating history");
        var recv = wallet.recv.map(function(x) { return x.address; });
        var change = wallet.change.map(function(x) { return x.address; });
        cb2 = cb2 || function(){}
        sx.history(recv.concat(change),eh(cb2,function(h) {
            var changed = wallet.update_txoset(h);
            console.log("History " + (changed ? "updated" : "unchanged"));
            wallet.postprocess()
            cb2(null,changed);
        }));
    })

    wallet.full_update = function(cb2) {
        async.series([
            wallet.update_change_addresses,
            wallet.load_receiving_addresses,
            wallet.update_history
        ],cb2);
    }
    
    wallet.getaddress = queuewrapper(function(change,cb2) {
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
    })


    var mk_signed_transaction = function(to,value,cb2) {
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

    var push_signed_transaction = function(tx, usedtxo, cb2) {
        async.series({
            shown: _.partial(sx.showtx,tx),
            hash: _.partial(sx.txhash,tx),
            validstatus: _.partial(sx.validtx,tx)
        },eh(cb2,function(r) {
            var validstatus = sx.jsonfy(r.validstatus)[0].Status;
            console.log(validstatus);
            if (validstatus == "Success") {
                for (var i = 0; i < usedtxo.length; i++) {
                    usedtxo[i].spend = r.hash+":"+i;
                }
                var newutxo = r.shown.outputs
                    .filter(txoIsMine)
                    .map(function(o) { delete o.script; return o; });

                console.log('Used UTXO: ',usedtxo,', New UTXO: ',newutxo);

                wallet.update_txoset(usedtxo.concat(newutxo));

                console.log('broadcasting: ',tx);

                sx.broadcast(tx,eh(cb2,function() {}));
                sx.bci_pushtx(tx,eh(cb2,function() {}));
                wallet.postprocess();
                cb2(null,r.hash);
            }
            else {
                cb2(validstatus);
            }
        }));
    }

    wallet.send = queuewrapper(function(to, value, cb2) {
        console.log("Attempting to send "+value+" satoshis to "+to);
        mk_signed_transaction(to,value,eh(cb2,function(obj) {
            console.log("Transaction created, attempting to push");
            push_signed_transaction(obj.tx,obj.utxo,cb2);
        }));
    })

    cb(null,wallet);
    wallet.full_update(eh(cbdone,function() { cbdone(null,wallet); }));
}

