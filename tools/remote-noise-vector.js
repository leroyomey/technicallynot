// The published test vector for Noise_KK_25519_AESGCM_SHA256, copied unchanged from the snow
// project's vector set (github.com/mcginty/snow, tests/vectors/snow.txt, fetched 2026-10-04). Do
// not edit: desktop/remote-noise.js must reproduce it.
module.exports = {
  'protocol_name': 'Noise_KK_25519_AESGCM_SHA256',
  'init_prologue':
    '5468657265206973206e6f20726967687420616e642077726f6e672e2054686572652773206f6e6c792066756e20616e6420626f72696e672e',
  'init_psks': [],
  'init_static': '9549823a99f0123c499ed64b03f96351089c548db8e62ad808613e832892b371',
  'init_ephemeral': 'cb6e9750688cdbc61b3cb94eee07ca8653119574b52cf6f00bf39b9e3a6e8ef6',
  'init_remote_static': '1a594f38f3fec41a4694ee3a280921acccd1f495ccdf9ea527034bb669f0994e',
  'resp_prologue':
    '5468657265206973206e6f20726967687420616e642077726f6e672e2054686572652773206f6e6c792066756e20616e6420626f72696e672e',
  'resp_psks': [],
  'resp_static': 'f012bd6139ec4c143ab597178fae7b38e5345db76a712da27f2354d1d49e2bb5',
  'resp_ephemeral': 'e90eda32e14188b31beb045d5dffe3c8d74997c2a080ef8cbf54535eeed471c8',
  'resp_remote_static': 'd4d368238fd33b4d50da1af6df801d4b2e31fc3d4fddd00a9d2f35e4cbb8d668',
  'messages': [
    {
      'payload': '771ab1a9e5b47a4918ae6e3c3090e2ed8003efab57810dfaa80480b17ca353ed',
      'ciphertext':
        '4ebc0a4c0f62be1035bdb0e593e8f869395f885d54f9addec79ddc077592be1dbdf392d7b24dc710aa9552408bd75a7efd2e2bcbe57c1ba4c7d108479ab505d3df574b860882218db04a12fc5e2e925f',
    },
    {
      'payload': '685d9d6e0db7ef2b2678f27b9d4efb3508dc9b28171e4b83f391a897cc04c660',
      'ciphertext':
        '6ab486b44c71d04b6f3db423964373878d2b1915f64225dc5dd82f6ee22559606adf38b57530c54f9c8b6e71cf416c4604895a02a4b711d5641466fe8f069ca26ec0b9d97b6d576aa7b22dc5aaeb3add',
    },
    {
      'payload': 'ec4a308c662e963deb387378aaa22648cae767b7f050531210e15fe778d19c29',
      'ciphertext':
        '340c26a14c3bde0e73bb5d309d4a85daab0b317552ae9203b677a1809a0a564dd34affe246da3dfd7fb17e0ad8bb5f93',
    },
    {
      'payload': 'e9968ebcbf844bde2a8b0d4f0487e3efbf30b1ec37bcecb17bda4c697d83b56e',
      'ciphertext':
        'db9b7164d1a9494582661aa0d815e6802c319345d90abb1ea5ea8ea01da648fccc9b6603b7c71116388afcec877b97d2',
    },
  ],
};
