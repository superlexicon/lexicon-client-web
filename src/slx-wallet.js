/**
 * Re-exports Unified Keypair Wallet, Identity, RPC & Header UI from `@superlexicon/sdk` (`lexicon-js-sdk`).
 */
export {
  shortHex,
  shortAddr,
  truncAddr4,
  PUBLIC_SUBNET1_WSS_RPC,
  BYTECODE_STORE_ADDRESS,
  getDefaultNodeWsUrl,
  SlxHfsCache,
  slxNodeRpc,
  SlxNonceQueue,
  SlxClient,
  SlxWalletManager,
  readOnChainIdentityNickname,
  readOnChainIdentityOwner,
} from '@superlexicon/sdk';
export {
  mountSlxChainBar,
  mountSlxWalletHeader,
  openIdentityCreateModal,
  injectSlxUiStyles,
} from '@superlexicon/sdk/ui';
