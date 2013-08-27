angular.module('multigui', []);

function MultiguiCtrl($scope,$http) {
    window.wscope = $scope;

    $scope.msiginp = { pubkeys: [] }

    $scope.errlogger = function(e) { $scope.message = e; }
    $scope.show_eto = function(eto) { 
        $scope.message = "";
        $scope.eto = eto;
        $scope.inputeto = JSON.stringify(eto);
    }

    $scope.getMultiAddr = function() {
        var obj = { k: $scope.msiginp.k }
        for (var i in $scope.msiginp.pubkeys) {
            obj["pub"+i] = $scope.msiginp.pubkeys[i];
        }
        $http.get("/msigaddr"+urlparams(obj))
            .success(function(r) {
                $scope.msig = r; $scope.msg = { class: 'monospace', text: r }
            })
            .error($scope.errlogger);
    }

    $scope.mktx = function() {
        $scope.message ("Loading");
        $scope.tx.from = $scope.msig.address;
        $scope.tx.script = $scope.msig.raw;
        $http.get("/mkmultitx"+urlparams($scope.tx))
            .success($scope.show_eto)
            .error($scope.errlogger);
    }

    $scope.sign = function() {
        $scope.errlogger("Loading");
        $http.get("/signeto"+urlparams({ eto: $scope.inputeto, privkey: $scope.privkey }))
            .success($scope.show_eto)
            .error($scope.errlogger)
    }

    $scope.$watch('inputeto',function() {
        try {
            $scope.eto = JSON.parse($scope.inputeto);
        }
        catch(e) {}
    });

    $scope.$watch('eto',function() {
        $scope.indices = [];
        $scope.instructions = [];
        for (var s in ($scope.eto || {}).inputscripts) {
            var i = $scope.indices.length;
            $scope.indices.push(i);
            $scope.instructions[i] = [
                "privkey=[PUT PRIVKEY HERE WITHOUT BRACKETS]",
                "echo "+$scope.eto.tx+" > /tmp/12345",
                "echo $privkey | sx sign-input /tmp/12345 "+i+" "+$scope.eto.inputscripts[i]
            ];
        }
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
