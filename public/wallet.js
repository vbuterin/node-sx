angular.module('wallet', []);

function WalletCtrl($scope,$http) {
    window.wscope = $scope;

    $scope.loadwallet = function(r) {
        $scope.wallet = r;
        $scope.msg = {};
    }
    $scope.errlogger = function(e) { $scope.msg = { text: e } }

    $scope.monospace_show = function(t) { $scope.msg = { class: 'monospace', text: t } }

    $scope.$watch('wallet',function() {
        $scope.balance = $scope.wallet ?
            $scope.wallet.utxo.reduce (function(sum,txo) { return sum+txo.value },0) / 100000000 :
            "NodeSX Wallet";
    });

    $scope.login = function() {
        $scope.msg = { text: "Loading..." }
        $scope.show_monospace = false;
        $http.get("/get"+urlparams($scope.user))
            .success($scope.loadwallet)
            .error($scope.errlogger);
    }

    $scope.send = function() {
        $scope.msg = { text: "Sending..." };
        $http.get("/send"+urlparams(merge($scope.user,$scope.sending)))
            .success($scope.monospace_show)
            .error($scope.errlogger);
    }

    $scope.getaddress = function() {
        $http.get("/addr"+urlparams($scope.user))
            .success(function(r) { wallet.recv += r; })
            .error($scope.errlogger);
    }

    $scope.reload = function(force) {
        $http.get("/get"+urlparams(merge($scope.user,force ? { force: force } : {})))
            .success($scope.loadwallet)
            .error($scope.errlogger);
    }

    $scope.reloadInterval = setInterval($scope.reload,15000);
}
