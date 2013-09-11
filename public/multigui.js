angular.module('multigui', []);

function MultiguiCtrl($scope,$http) {
    window.wscope = $scope;

    $scope.msiginp = { pubkeys: [] }
    $scope.msig = {}
    $scope.tx = {}
    $scope.activetab = 0;

    $scope.dialog = function(d,e) {
        $scope.message = { title: d, body: e }
    }
    $scope.inprogress = function(e) { 
        $scope.message = { title: "Loading", body: e, loading: true }
    }
    $scope.errlogger = _.partial($scope.dialog,"Error");
    $scope.txpushed = _.partial($scope.dialog,"Transaction");
    $scope.clearmessage = function() { $scope.message = null; }

    $scope.show_eto = function(eto) { 
        $scope.message = "";
        $scope.eto = eto;
        $scope.inputeto = JSON.stringify(eto);
        return eto;
    }

    $scope.tryApply = function() { if (!$scope.$$phase) $scope.$apply() }

    //Replaces private key or address in pubkey slot i with the pubkey
    $scope.convertKey = function(obj,prop,cb) {
        cb = cb || function(){};
        // Is already a pubkey
        if ($scope.is_pubkey(obj[prop]) || !obj[prop]) {
            return cb(obj[prop]) 
        }
        // Is a private key in either format
        else if ($scope.is_wif_privkey(obj[prop]) || $scope.is_hex_privkey(obj[prop])) {
            obj[prop] = privtopub(obj[prop]);
        }
        // Is an address
        else if ($scope.is_addr(obj[prop])) {
            var addr = obj[prop];
            $scope.inprogress("Attempting to recover public key from blockchain");
            $http.post('/addrtopub',{ address: obj[prop] })
                .success(function(r) {
                    $scope.clearmessage();
                    var r = r.replace(/"/g,'');
                    obj[prop] = r;
                    cb(r);
                })
                .error(function(r) {
                    if (addr == obj[prop]) { obj[prop] = "" }
                    dispatch(r) ? $scope.errlogger(dispatch(r))
                                : $scope.clearmessage();
                });
        }
        // Is an abbreviated public key
        else if ($scope.is_hex(obj[prop]) && obj[prop].length >= 5) {
            var opts = [];
            for (var pub in $scope.etosigarray) {
                if (pub.indexOf(obj[prop]) == 0) { opts.push(pub); }
            }
            if (opts.length == 1) { obj[prop] = opts[0]; }
        }
    }

    //Retrieves multisig address from data in $scope.msiginp
    $scope.getMultiAddr = function() {
        var pubs = [];
        for (var i in $scope.msiginp.pubkeys) {
            if ($scope.msiginp.pubkeys[i]) {
                pubs.push($scope.msiginp.pubkeys[i]);
                if (!$scope.is_pubkey($scope.msiginp.pubkeys[i])) {
                    return $scope.convertKey($scope.msiginp.pubkeys,i);
                }
            }
        }
        var k = $scope.msiginp.k,
            n = pubs.length;
            pubs.sort(function(x,y) { return x>y });

        if (!k || n == 0 || k > n) { 
            return $scope.msig = {};
        }
        var script = [k].concat(pubs).concat([n,174]),
            raw = rawscript(script),
            addr = script_to_address(raw);
        
        $scope.msig = {
            k: k,
            n: n,
            pubs: pubs,
            raw: raw,
            address: addr
        }
    }

    $scope.$watch('msiginp',$scope.getMultiAddr,true);
    $scope.$watch('msiginp.pubkeys',$scope.getMultiAddr,true);
    $scope.$watch('instrpubkey',function() { $scope.convertKey($scope,'instrpubkey') });

    $scope.help = function(key) {
        $scope.message = {
            title: "Help",
            body: help[key],
            actiontext: "Don't show help",
            action: function() { $scope.hidehelp = true; $scope.message = null; }
        }
    }

    //Get address balance
    $scope.getaddrbalance = function(address,showretrieving) {
        if (!address) return $scope.balance = null;
        if (showretrieving) $scope.balance = "Retrieving..."
        $http.post("/history",{ address: address, unspent: true })
            .success(function(r) {
                $scope.balance = r.reduce(function(s,txo) { return s + txo.value },0) / 100000000;
            })
    }

    $scope.$watch('msig.address',$scope.getaddrbalance);
    setInterval(function() { $scope.getaddrbalance($scope.msig.address,false) },10000);

    //Try to sync address -> scripthash
    $scope.$watch('msig.address',function(address) {
        if (!$scope.msig.script && address) {
            $http.post("/addr_to_pubkey_or_script",{ address: address })
                .success(function(r) {
                    $scope.msig.raw = $scope.msig.raw || r.replace(/"/g,'');
                })
                .error(function() {});
        }
    });

    //Try to sync scripthash -> address
    $scope.$watch('msig.raw',function() {
        if (!$scope.msig.raw) return;
        $scope.msig.address = script_to_address($scope.msig.raw);
    });

    //Make transaction and ETO from data in $scope.tx and $scope.msig
    $scope.mktx = function() {
        $scope.tx = $scope.tx || {};
        $scope.tx.from = $scope.msig.address;
        $scope.tx.script = $scope.msig.raw;
        $scope.inprogress("Creating transaction");
        $http.post("/mkmultitx",$scope.tx)
            .success(function(r) { 
                $scope.show_eto(r);
                $scope.activetab = 2;
                $scope.clearmessage();
            })
            .error($scope.errlogger);
    }

    //Sign ETO
    $scope.sign = function() {
        $scope.eto = sign_eto($scope.eto,$scope.pk);
    }

    //Watch for user-inputted ETO
    $scope.$watch('inputeto',function() {
        var m = /^[0-9a-f][0-9a-f]*$/.exec($scope.inputeto);
        if (m) {
            var map = { tx: $scope.inputeto }
            if ($scope.msig.address && $scope.msig.raw) {
                map[$scope.msig.address = $scope.msig.raw];
            }
            $http.post('/mketo',map)
                .success($scope.show_eto)
        }
        else if ($scope.inputeto) {
            try { $scope.eto = JSON.parse($scope.inputeto); }
            catch(e) { $scope.errlogger(e); }
        }
    });

    // Self-explanatory methods
    $scope.is_base58 = function(data) {
        return data && !!RegExp('^[0-9A-Za-z]*$').exec(data) && !$scope.is_hex(data);
    }
    $scope.is_hex = function(data) {
        return data && !!RegExp('^[0-9a-fA-F]*$').exec(data);
    }
    $scope.is_pubkey = function(x) {
        return x && ['02','03','04'].indexOf(x.substring(0,2)) >= 0 && [66,130].indexOf(x.length) >= 0;
    }
    $scope.is_wif_privkey = function(x) {
        return $scope.is_base58(x) && 40 <= x.length && x.length <= 60;
    }
    $scope.is_hex_privkey = function(x) {
        return $scope.is_hex(x) && x.length == 64;
    }
    $scope.is_addr = function(x) {
        return x && $scope.is_base58(x) && 20 <= x.length && x.length <= 34;
    }

    //Given something in eto.inputscripts, return a list of pubkeys
    $scope.pubkeys_from_script = function(scr) {
        if ($scope.is_pubkey(scr)) {
            return scr;
        }
        var pos = 0, o = [];
        // Limited special-purpose scripting engine
        // https://en.bitcoin.it/wiki/Script
        while (pos < scr.length) {
            var n = '0123456789abcdef'.indexOf(scr[pos])*16
                  + '0123456789abcdef'.indexOf(scr[pos+1]);
            if (n >= 1 && n <= 75) {
                o.push(scr.substring(pos+2,pos+2+2*n));
                pos += 2 + 2*n;
            }
            else pos += 2;
        }
        return o;
    }

    //Returns an object { <pub1>: [ <sig-pub1-0>, <sig-pub1-1>... ], ... }
    //where <sig-pub[i]-[j]> = 0 if input j does not need pubkey i's signature
    //                         1 if input j is signed by pubkey i
    //                         2 if input j is fully signed
    //                         -1 if input j is not signed by pubkey i
    $scope.sig_array_from_eto = function(eto) {
        if (!eto) { return null; }
        var pubkeyarray = eto.inputscripts.map($scope.pubkeys_from_script);
        var arr = {};
        for (var i = 0; i < pubkeyarray.length; i++) {
            for (var j = 0; j < pubkeyarray[i].length; j++) {
                arr[pubkeyarray[i][j]] = arr[pubkeyarray[i][j]] || [];
                arr[pubkeyarray[i][j]][i] = 
                      !eto.sigs            ? -1
                    : !eto.sigs[i]         ? -1
                    : eto.sigs[i] === true ? 2
                    : !!eto.sigs[i][j]     ? 1 : -1;
            }
        }
        return arr;
    }

    //Updates the instructions for signing an input with SX
    //Uses $scope.eto and instrpubkey
    $scope.update_instructions = function() {
        var indices = [];
        var arr = ($scope.etosigarray || {})[$scope.instrpubkey];
        if (!arr) {
            return $scope.instructions = null;
        }
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] == -1) { indices.push(i); }
        }
        if (indices.length === 0) {
            return $scope.instructions = null;
        }
        $scope.instructions = [
            "privkey=[PUT PRIVKEY HERE WITHOUT BRACKETS]",
            "echo "+$scope.eto.tx+" > /tmp/12345"
        ]
        for (var i = 0; i < indices.length; i++) {
            var ins = "echo $privkey | sx sign-input /tmp/12345 "+indices[i]+" "+$scope.eto.inputscripts[i];
            $scope.instructions.push(ins);
        }
    }
    $scope.$watch('etosigarray',$scope.update_instructions);
    $scope.$watch('instrpubkey',$scope.update_instructions);

    //When the ETO changes, change the etosigarray object and the inputeto object
    $scope.$watch('eto',function() {
        $scope.indices = [];
        $scope.instructions = [];
        $scope.etopubkeys = [];
        $scope.etosigarray = $scope.sig_array_from_eto($scope.eto);
        if ($scope.eto) {
            $scope.etofullysigned = $scope.eto.sigs
                .reduce(function(t,s) { return t && (s === true) },true)
            $scope.etosigs = get_sigs($scope.eto);
        }
        else {
            $scope.etofullysigned = false;
        }
        var j = JSON.stringify($scope.eto);
        if (j != $scope.inputeto) $scope.inputeto = j;
    });

    //Apply externally made signature to ETO
    $scope.apply = function() {
        $scope.inprogress("Applying signature");
        setTimeout(function() {
            try {
                apply_sig_to_eto($scope.eto,$scope.sig,function(eto) {
                    $scope.eto = eto;
                    $scope.message = null;
                    $scope.tryApply();
                },_.compose($scope.tryApply,$scope.errlogger));
            }
            catch(e) { 
                _.compose($scope.tryApply,$scope.errlogger)(e);
            }
        },100);
    }

    //Push completed transaction
    $scope.push = function() {
        $scope.inprogress("Pushing transaction");
        $http.post("/pusheto",{ eto: $scope.inputeto })
            .success($scope.txpushed)
            .error($scope.errlogger)
    }
}
