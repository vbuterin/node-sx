var help = {
    privkey: "The private key is the secret number that allows you to spend the money that has been sent to you. To retrieve the private key, use the following instructions:\n\n"
           + "Electrum: Go to the \"Receive\" tab, right click on your address and click \"Private key\".",
    pubkey: "The public key is an intermediate stage between your private key and your address. Public keys are safe to reveal, and encode information needed to make multisignature addresses and verify transactions. Most wallets do not expose public keys; however, if you have ever spent money from your address, then you can enter your address and this program will retrieve your public key from the blockchain. You can also enter your private key into the field and have it converted automatically.",
    script: "The script that was generated alongside the multisignature address when you created it",
    sig: "A signature is a string about 140 letters and numbers long starting with \"304\" that requires your private key to generate. See the \"SX Instructions\" tab for copy-paste command line instructions for generating the signatures with SX.",
    eto: "The \"extended transaction object\" includes the transaction, all of the information needed to sign the transaction and existing partial signatures. Pass the ETO to someone over a chat channel or USB key and they will be able to paste it in this textbox on their own computer, possibly even offline, sign it, and pass it back to you or on to the next signer."
}
var dispatch_table = {
    "No spends": "No spends from this address. Either try other addresses until one works, enter your public key directly or (if you are running this wallet on localhost) enter your private key instead"
}
var dispatch = function(x) {
    for (var s in dispatch_table) { if (x.indexOf(s) >= 0) return dispatch_table[s]; }
    return null;
}
var dispatch_with_default = function(x) { return dispatch(x) || x }
