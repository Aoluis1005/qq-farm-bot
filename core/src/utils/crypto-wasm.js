const { TsdkRuntime } = require('./tsdk-runtime');

let defaultRuntime = null;

function setRuntime(runtime) {
    if (runtime != null && !(runtime instanceof TsdkRuntime)) {
        throw new TypeError('crypto-wasm runtime must be a TsdkRuntime');
    }
    defaultRuntime = runtime;
}

function getRuntime() {
    if (!defaultRuntime) throw new Error('TSDK runtime has not been configured');
    return defaultRuntime;
}

async function initWasm() {
    return getRuntime().init();
}

async function generateToken(value) {
    await initWasm();
    return getRuntime().generateToken(value);
}

async function encryptBuffer(buffer) {
    await initWasm();
    return getRuntime().encrypt(buffer);
}

async function decryptBuffer(buffer) {
    await initWasm();
    return getRuntime().decrypt(buffer);
}

module.exports = {
    setRuntime,
    getRuntime,
    initWasm,
    generateToken,
    encryptBuffer,
    decryptBuffer,
    encryptData: generateToken,
};
