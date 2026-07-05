const crypto = require('node:crypto');

const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function createGatewayToken() {
    // 官方 AceManager.randomStr(): 64~127 个字母数字字符，末尾追加 "="。
    const length = crypto.randomInt(64, 128);
    let token = '';
    for (let index = 0; index < length; index += 1) {
        token += TOKEN_ALPHABET[crypto.randomInt(0, TOKEN_ALPHABET.length)];
    }
    return `${token}=`;
}

module.exports = { createGatewayToken };
