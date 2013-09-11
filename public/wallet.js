angular.module('wallet', []);

function WalletCtrl($scope,$http) {
    window.wscope = $scope;

    var LW = function(resetmsg,r) {
        if ($scope.debug) {
            console.log('Loaded',resetmsg,r);
            console.log('utxo',r.utxo.map(function(x) { return x.output }));
            console.log('stxo',r.stxo.map(function(x) { return x.output }));
        }
        $scope.wallet = r;
        if (resetmsg) $scope.msg = {};
    }
    $scope.loadwallet = _.partial(LW,true);
    $scope.silent_loadwallet = _.partial(LW,false);

    $scope.errlogger = function(e) { $scope.msg = { text: e } }

    $scope.monospace_show = function(t) { $scope.msg = { class: 'monospace', text: t } }

    $scope.$watch('wallet',function() {
        $scope.balance = $scope.wallet ?
            $scope.wallet.utxo.reduce (function(sum,txo) { return sum+txo.value },0) / 100000000 :
            "NodeSX Wallet";
        if ($scope.debug) {
            console.log('Balance',$scope.balance);
        }
    });

    $scope.login = function() {
        if (!$scope.user) {
             return $scope.wallet = null; 
        }
        $scope.msg = { text: "Loading..." }
        $http.post("/get",$scope.user)
            .success($scope.loadwallet)
            .error($scope.errlogger);
    }

    $scope.send = function() {
        $scope.msg = { text: "Sending..." };
        $http.post("/send",merge($scope.user,$scope.sending))
            .success(function(r) { 
                $scope.monospace_show(r);
                $scope.reload(); 
            })
            .error($scope.errlogger);
    }

    $scope.getaddress = function() {
        $http.post("/addr",$scope.user)
            .success(function(r) { wallet.recv += r; })
            .error($scope.errlogger);
    }

    $scope.reload = function(force) {
        if (force) { $scope.msg = { text: "Reloading..." } }
        $http.post("/get",merge($scope.user,force ? { reload: force } : {}))
            .success(force ? $scope.loadwallet: $scope.silent_loadwallet)
            .error($scope.errlogger);
    }

    $scope.reloadInterval = setInterval($scope.reload,5000);
}
