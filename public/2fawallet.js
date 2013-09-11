angular.module('2fawallet', []);

function TFAWalletCtrl($scope,$http) {
    window.wscope = $scope;

    $scope.user = {};
    $scope.sending = {};
    $scope.balance = "2FA Wallet";

    $scope.updatemessage = function(m) {
        if ($scope.message) { $scope.message = m; }
    }

    $scope.errlogger = function(r) {
         $scope.message = { title: "Error", body: r.data };
         throw r;
    }

    var entropy = "",
        owm = window.onmousemove;

    window.onmousemove = function(e) {
        entropy += "" + e.x + e.y + (new Date().getTime() % 1337);
        if (entropy.length > 2000) {
            window.onmousemove = owm;
        }
        if (owm) owm(e);
    }

    $scope.login = function() {
        $scope.message = {
            title: "Loading",
            body: "Generating primary private key",
            loading: true
        };
        if (!$scope.$$phase) { $scope.$apply(); }

        setTimeout(function(){
            var seed = $scope.user.name + ":" + $scope.user.pw;
            $scope.user.priv = base58checkEncode(slowsha(seed),128);
            $scope.user.pub = privtopub($scope.user.priv);
            var checksum = sha256("checksum:" + $scope.user.pw);
    
            ($scope.message || {}).body = "Generating backup private key";
            var rndseed = ""+new Date().getTime()+Math.random()+entropy;
            $scope.user.bkpriv = base58checkEncode(sha256(rndseed),128);
            $scope.user.bkpub = privtopub($scope.user.bkpriv);
    
            ($scope.message || {}).body = "Registering account";
            $http.post('/register',{
                name: $scope.user.name,
                pub1: $scope.user.pub,
                pub2: $scope.user.bkpub
            })
            .then(function(resp) {
                ($scope.message || {}).body = "Processing response";
                console.log(resp.data);
                $scope.user.tfakey = resp.data.key;
                $scope.user.address = resp.data.addrdata.address;
                $scope.user.script = resp.data.addrdata.raw;
                $scope.user.pubs = resp.data.addrdata.script
                    .filter(function(x) { return x.length == 66 || x.length == 130 })
                    .sort(function(x,y) { return x>y });
                if (!resp.data.verified) {
                    $scope.state = 1;
                    el("qr1").innerHTML = "";
                    new QRCode(el("qr1"),{ 
                        text: $scope.user.bkpriv,
                        width: 120,
                        height: 120
                    });
                    qs("#qr1 img")[0].style.margin = "0 auto";
                }
                else {
                    delete $scope.user.bkpriv;
                    delete $scope.user.bkpub;
                    $scope.state = 3;
                }
                $scope.message = null;
            },$scope.errlogger);
        },100);
    }
    $scope.confirmSavedBackup = function() {
        var next;
        $scope.message = {
            title: "Confirm",
            body: "Did you actually save the QR code and/or the private key? If you do not save them the data will be lost forever as soon as you close this browser session",
            actiontext: "Yes, I did, don't worry",
            action: function() { next(); }
        }
        next = function() {
            $scope.state = 2;
            new QRCode(el("qr2"),{
                text: "otpauth://totp/EgoraMultisig?secret=" + $scope.user.tfakey,
                width: 120,
                height: 120
            });
            qs("#qr2 img")[0].style.margin = "0 auto";
            $scope.message = null;
        }
    }
    $scope.confirmOTP = function(name,otp,cb) {
        return $http.post('/validate', { name: $scope.user.name, otp: $scope.otp })
            .then(function(r) {
                console.log('yay',r);
                $scope.state = 3;
                $scope.msg = { text: r.data };
                $scope.getbalance();
            },$scope.errlogger);
    }
    $scope.send = function() {
        $scope.message = {
            title: "Sending",
            body: "Generating transaction",
            loading: true
        }
        $http.post('validate', { name: $scope.user.name, otp: $scope.sending.otp })
        .then(function() {
            return $http.post('/mkmultitx', {
                from: $scope.user.address,
                script: $scope.user.script,
                to: $scope.sending.to,
                value: $scope.sending.value
            })
        },$scope.errlogger)
        .then(function(r) {
            ($scope.message || {}).body = "Signing transaction";
            var eto = r.data;
            var pubindex = $scope.user.pubs.indexOf($scope.user.pub);
            for (var i = 0; i < eto.inputscripts.length; i++) {
                eto.sigs[i] = eto.sigs[i] || [];
                if (eto.sigs[i] === true) { continue; }
                eto.sigs[i][pubindex] = multisign(eto.tx,i,eto.inputscripts[i],$scope.user.priv);
            }
            ($scope.message || {}).body = "Sending transaction to server for second signature";
            return $http.post('/2fasign',{
                name: $scope.user.name,
                otp: $scope.sending.otp,
                eto: eto
            })
        },$scope.errlogger)
        .then(function(r) {
            ($scope.message || {}).body = "Pushing transaction";
            var eto = r.data;
            return $http.post('/pusheto',{ eto: eto })
        },$scope.errlogger)
        .then(function(r) {
            $scope.balance -= $scope.sending.value;
            ($scope.message || {}).body = r.data;
            ($scope.message || {}).loading = false;
        },$scope.errlogger)
    }
    $scope.getbalance = function() {
        if (!$scope.user.address) { return }
        $http.post('/history', { address: $scope.user.address })
            .then(function(r) {
                $scope.balance = r.data.filter(function(x) { return !x.spend })
                                       .reduce(function(val,txo) { 
                                           return val + txo.value 
                                       },0) / 100000000;
            },$scope.errlogger);
    }
    setInterval($scope.getbalance,20000);
}
