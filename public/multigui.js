angular.module('multigui', []);

function MultiguiCtrl($scope,$http) {
    window.wscope = $scope;

    $scope.msiginp = { pubkeys: [] }
    $scope.msig = {}
    $scope.activetab = 0;

    $scope.errlogger = function(e) { $scope.message = e; }
    $scope.show_eto = function(eto) { 
        $scope.message = "";
        $scope.eto = eto;
        $scope.inputeto = JSON.stringify(eto);
    }

    $scope.getMultiAddr = function() {
        var obj = { k: $scope.msiginp.k || 0, n: 0 }
        for (var i in $scope.msiginp.pubkeys) {
            if ($scope.msiginp.pubkeys[i]) {
                obj["pub"+i] = $scope.msiginp.pubkeys[i];
                obj.n += 1;
            }
        }
        if (obj.k == 0 || obj.n == 0 || obj.k > obj.n) { 
            return $scope.msig = {};
        }
        $http.get("/msigaddr"+urlparams(obj))
            .success(function(r) {
                $scope.msig = r;
                $scope.balance = "Retrieving..."
                console.log($scope.balance);
            })
            .error($scope.errlogger);
    }

    $scope.$watch('msiginp',$scope.getMultiAddr,true);

    $scope.getaddrbalance = function(address) {
        console.log('f',address);
        if (!address) return $scope.balance = null;
        console.log('grabbing');
        $http.get("/history"+urlparams({ address: address, unspent: true }))
            .success(function(r) {
                $scope.balance = r.reduce(function(s,txo) { return s + txo.value },0) / 100000000;
            })
            .error($scope.errlogger);
    }
    //setInterval(function() { $scope.getaddrbalance($scope.msig.address) },5000);
    $scope.$watch('msig.address',$scope.getaddrbalance);

    $scope.$watch('msig.address',function(address) {
        if (!$scope.msig.script && address) {
            $http.get("/addr_to_pubkey_or_script"+urlparams({ address: address }))
                .success(function(r) {
                    $scope.msig.raw = $scope.msig.raw || r.replace(/"/g,'');
                })
                .error(function() {});
        }
    });

    $scope.mktx = function() {
        $scope.tx = $scope.tx || {};
        $scope.tx.from = $scope.msig.address;
        $scope.tx.script = $scope.msig.raw;
        $http.get("/mkmultitx"+urlparams($scope.tx))
            .success(function(r) { $scope.show_eto(r); $scope.activetab = 2; })
            .error($scope.errlogger);
    }

    $scope.sign = function() {
        $scope.errlogger("Loading");
        $http.get("/signeto"+urlparams({ eto: $scope.inputeto, privkey: $scope.tx.pk }))
            .success($scope.show_eto)
            .error($scope.errlogger)
    }

    $scope.$watch('inputeto',function() {
        var m = /^[0-9a-f][0-9a-f]*$/.exec($scope.inputeto);
        if (m) {
            var map = { tx: $scope.inputeto }
            if ($scope.msig.address && $scope.msig.raw) {
                map[$scope.msig.address = $scope.msig.raw];
            }
            $http.get('/mketo'+urlparams(map))
                .success($scope.show_eto)
                .error($scope.errlogger);
        }
        else {
            try { $scope.eto = JSON.parse($scope.inputeto); }
            catch(e) { $scope.errlogger(e); }
        }
    });

    $scope.is_pubkey = function(x) {
        return ['02','03','04'].indexOf(x.substring(0,2)) >= 0 && ['66','130'].indexOf(x.length) >= 0;
    }

    $scope.is_wif_privkey = function(x) {
        return (x[0] == '5' || x[0] == 'K') && 40 <= x.length <= 60;
    }

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
                    : eto.sigs[i] === true ? 1
                    : !!eto.sigs[i][j]     ? 1 : -1;
            }
        }
        return arr;
    }

    $scope.update_instructions = function() {
        var indices = [];
        var arr = ($scope.etosigarray || {})[$scope.instrpubkey];
        console.log($scope.instrpubkey,$scope.etosigarray,arr);
        if (!arr) {
            return $scope.instructions = [];
        }
        for (var i = 0; i < arr.length; i++) {
            console.log(arr[i]);
            if (arr[i] == -1) { indices.push(i); }
        }
        if (indices.length === 0) {
            return $scope.instructions = [];
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

    $scope.$watch('eto',function() {
        $scope.indices = [];
        $scope.instructions = [];
        $scope.etopubkeys = [];
        for (var s in ($scope.eto || {}).inputscripts) {
            var i = $scope.indices.length,
                scr = $scope.eto.inputscripts[i];
            $scope.indices.push(i);
            $scope.instructions[i] = [
                "privkey=[PUT PRIVKEY HERE WITHOUT BRACKETS]",
                "index=[PUT INDEX HERE WITHOUT BRACKETS]",
                "echo "+$scope.eto.tx+" > /tmp/12345",
                "echo $privkey | sx sign-input /tmp/12345 "+i+" "+scr
            ];
        }
        $scope.etosigarray = $scope.sig_array_from_eto($scope.eto);
        $scope.etofullysigned = $scope.eto 
            ? $scope.eto.sigs.reduce(function(t,s) { return t && (s === true) },true)
            : false;
    });

    $scope.apply = function() {
        $scope.errlogger("Loading");
        $http.get("/applysigtoeto"+urlparams({ eto: $scope.inputeto, sig: $scope.sig }))
            .success($scope.show_eto)
            .error($scope.errlogger)
    }

    $scope.push = function() {
        $scope.errlogger("Loading");
        $http.get("/pusheto"+urlparams({ eto: $scope.inputeto }))
            .success($scope.errlogger)
            .error($scope.errlogger)
    }
}
