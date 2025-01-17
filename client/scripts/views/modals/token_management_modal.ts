import 'modals/token_management_modal.scss';

import { isAddress } from 'web3-utils';
import m from 'mithril';
import $ from 'jquery';
import BN from 'bn.js';
import { FormGroup, FormLabel, Input, Button } from 'construct-ui';

import { ERC20Token } from 'adapters/chain/ethereum/types';
import { RadioSelectorFormField } from 'views/components/forms';
import EthereumAccount from 'controllers/chain/ethereum/account';
import EthereumAccounts from 'controllers/chain/ethereum/accounts';

interface IAttrs {
  accounts: EthereumAccounts;
  account: EthereumAccount;
  contractAddress: string;
  tokenAddress: string;
}

type ToggleAction = 'approve' | 'transfer';

interface IState {
  tokenAmount: string;
  tokensAvailable: string;
  tokensAllocatedToContract: string;
  toggleValue: ToggleAction;
  error?: string;
  recipient?: string;
  recipientHoldings?: string;
}

const TokenManagementModal: m.Component<IAttrs, IState> = {
  oninit: (vnode) => {
    vnode.state.toggleValue = 'approve';
    Promise.all([
      vnode.attrs.account.tokenBalance(vnode.attrs.tokenAddress),
      vnode.attrs.account.tokenAllowance(vnode.attrs.tokenAddress, vnode.attrs.contractAddress),
    ]).then(([ tokensAvailable, tokensAllocated ]) => {
      vnode.state.tokensAvailable = tokensAvailable.toString();
      vnode.state.tokensAllocatedToContract = tokensAllocated.toString();
      m.redraw();
    });
  },
  view: (vnode: m.VnodeDOM<IAttrs, IState>) => {
    const content = [];
    if (vnode.state.toggleValue === 'approve') {
      content.push(
        m(FormGroup, [
          m(FormLabel, 'Amount of token to approve (If you want to become a DAO member, you must allow it to handle some of your tokens)'),
          m(Input, {
            defaultValue: vnode.state.tokenAmount,
            oncreate: (vvnode) => {
              $(vvnode.dom).focus();
            },
            oninput: (e) => {
              const result = (e.target as any).value;
              vnode.state.tokenAmount = result.toString();
              m.redraw(); // TODO: comment why this is needed?
            }
          })
        ]),
        m('.token-data-label', [ `Moloch contract address: ${vnode.attrs.contractAddress}` ]),
        m('.token-data-label',
          [ `ERC20 Tokens allocated to contract: ${vnode.state.tokensAllocatedToContract || '--'}` ]),
      );
    } else if (vnode.state.toggleValue === 'transfer') {
      content.push(
        m(FormGroup, [
          m(FormLabel, 'Token recipient'),
          m(Input, {
            oncreate: (vvnode) => {
              $(vvnode.dom).focus();
            },
            oninput: (e) => {
              const result = (e.target as any).value;
              vnode.state.recipient = result.toString();

              // once recipient is entered, fetch its token balance
              if (isAddress(vnode.state.recipient)) {
                const acct = vnode.attrs.accounts.get(vnode.state.recipient);
                acct.tokenBalance(vnode.attrs.tokenAddress).then((v) => {
                  if (v) {
                    vnode.state.recipientHoldings = v.toString();
                  }
                  m.redraw();
                });
              }
            },
          }),
        ]),
        m(FormGroup, [
          m(FormLabel, 'Amount of token to transfer'),
          m(Input, {
            defaultValue: vnode.state.tokenAmount,
            oncreate: (vvnode) => {
              $(vvnode.dom).focus();
            },
            oninput: (e) => {
              const result = (e.target as any).value;
              vnode.state.tokenAmount = result.toString();
              m.redraw(); // TODO: comment why this is necessary?
            }
          })
        ]),
        m('.token-data-label', [ `Recipient holdings: ${vnode.state.recipientHoldings || '--'}` ]),
      );
    } else {
      throw new Error(`unknown toggle value: ${vnode.state.toggleValue}`);
    }
    return m('.TokenManagementModal', [
      m('.header', vnode.state.toggleValue === 'approve' ? 'Approve' : 'Transfer'),
      m('.compact-modal-body', [
        m('.token-data-label', [ `ERC20 contract address: ${vnode.attrs.tokenAddress}` ]),
        m('.token-data-label', [ `Your ERC20 holdings: ${vnode.state.tokensAvailable || '--'}` ]),
        m(RadioSelectorFormField, {
          callback: (value: ToggleAction) => {
            vnode.state.toggleValue = value;
            m.redraw();
          },
          choices: [
            { label: 'Approve Tokens', value: 'approve', checked: true },
            { label: 'Transfer Tokens', value: 'transfer', checked: false },
          ],
          name: 'token-action-switcher',
        }),
        ...content,
        m(Button, {
          type: 'submit',
          rounded: true,
          disabled: !vnode.state.tokensAvailable || !vnode.state.tokenAmount,
          onclick: (e) => {
            e.preventDefault();
            const tokens = new ERC20Token(vnode.attrs.tokenAddress, new BN(vnode.state.tokenAmount));
            if ((new BN(vnode.state.tokensAvailable, 10)).lt(tokens)) {
              vnode.state.error = 'Insufficent token holdings';
              return;
            }
            let txP;
            if (vnode.state.toggleValue === 'approve') {
              txP = vnode.attrs.account.approveTokenTx(tokens, vnode.attrs.contractAddress);
            } else if (vnode.state.toggleValue === 'transfer') {
              if (!isAddress(vnode.state.recipient)) {
                vnode.state.error = 'Recipient address invalid.';
                return;
              }
              txP = vnode.attrs.account.sendTokenTx(tokens, vnode.state.recipient);
            } else {
              throw new Error(`Unknown toggle value: ${vnode.state.toggleValue}.`);
            }
            txP
              .then((result) => {
                $(vnode.dom).trigger('modalforceexit');
                m.redraw();
              })
              .catch((err) => {
                console.error(err);
                vnode.state.error = err.message;
              });
          },
          label: 'Approve',
        }),
        vnode.state.error && m('.error', vnode.state.error),
      ]),
    ]);
  }
};

export default TokenManagementModal;
