import 'components/proposals/treasury_embed.scss';

import $ from 'jquery';
import m from 'mithril';
import { Button } from 'construct-ui';
import { AddressInfo } from 'models';

import app from 'state';
import { formatCoin } from 'adapters/currency';
import { idToProposal } from 'identifiers';
import { SubstrateDemocracyReferendum } from 'controllers/chain/substrate/democracy_referendum';
import SubstrateDemocracyProposal from 'controllers/chain/substrate/democracy_proposal';
import { SubstrateCollectiveProposal } from 'controllers/chain/substrate/collective_proposal';
import { SubstrateTreasuryProposal } from 'controllers/chain/substrate/treasury_proposal';
import User from 'views/components/widgets/user';
import Substrate from 'controllers/chain/substrate/main';

const TreasuryEmbed: m.Component<{ proposal }> = {
  view: (vnode) => {
    const { proposal } = vnode.attrs;

    // show link to treasury proposal if this is a proposal that passes a treasury spend
    if ((proposal instanceof SubstrateDemocracyProposal
         || proposal instanceof SubstrateDemocracyReferendum
         || proposal instanceof SubstrateCollectiveProposal)) {

      let treasuryProposalIndex;
      const call = proposal instanceof SubstrateDemocracyProposal ? proposal.preimage
        : proposal instanceof SubstrateDemocracyReferendum ? proposal.preimage
          : proposal instanceof SubstrateCollectiveProposal ? proposal.call : null;

      if (call?.section === 'treasury' && (call.method === 'approveProposal' || call.method === 'rejectProposal')) {
        treasuryProposalIndex = call.args[0];
      } else {
        return;
      }

      let treasuryProposal;
      try {
        treasuryProposal = idToProposal('treasuryproposal', +treasuryProposalIndex);
      } catch (e) {
        return;
      }
      if (!treasuryProposal) return;

      return m('.TreasuryEmbed', [
        m('.treasury-embed-section', [
          m('strong', [
            `Treasury Proposal ${treasuryProposalIndex}`,
          ]),
          m('p', [
            'Awards ',
            formatCoin(treasuryProposal.value),
            ' to ',
            m(User, {
              user: new AddressInfo(null, treasuryProposal.beneficiaryAddress, app.activeChainId(), null),
              linkify: true,
            }),
          ]),
          app.activeChainId() && m(Button, {
            href: `/${app.activeChainId()}/proposal/treasuryproposal/${treasuryProposalIndex}`,
            onclick: (e) => {
              e.preventDefault();
              m.route.set(`/${app.activeChainId()}/proposal/treasuryproposal/${treasuryProposalIndex}`);
            },
            intent: 'primary',
            label: 'Go to proposal',
            fluid: true,
            rounded: true,
          }),
        ]),
      ]);
    } else if (proposal instanceof SubstrateTreasuryProposal) {
      const democracyProposals = ((app.chain as Substrate).democracyProposals?.store?.getAll() || [])
        .filter((p) => p.preimage?.section === 'treasury'
                && (p.preimage?.method === 'approveProposal' || p.preimage?.method === 'rejectProposal')
                && p.preimage?.args[0] === proposal.identifier);
      const referenda = ((app.chain as Substrate).democracy?.store?.getAll() || [])
        .filter((r) => r.preimage?.section === 'treasury'
                && (r.preimage?.method === 'approveProposal' || r.preimage?.method === 'rejectProposal')
                && r.preimage?.args[0] === proposal.identifier);
      const councilMotions = ((app.chain as Substrate).council?.store?.getAll() || [])
        .filter((mo) => mo.call.section === 'treasury'
                && (mo.call.method === 'approveProposal' || mo.call.method === 'rejectProposal')
                && mo.call.args[0] === proposal.identifier);

      return m('.TreasuryEmbed', [
        democracyProposals.map((p) => m('.treasury-embed-section', [
          m('strong', [
            `Democracy Proposal ${p.shortIdentifier}`,
          ]),
          m('p', [
            p.preimage?.method === 'approveProposal' && 'Approves this proposal',
            p.preimage?.method === 'rejectProposal' && 'Rejects this proposal',
          ]),
          app.activeChainId() && m(Button, {
            href: `/${app.activeChainId()}/proposal/democracyproposal/${p.identifier}`,
            onclick: (e) => {
              e.preventDefault();
              m.route.set(`/${app.activeChainId()}/proposal/democracyproposal/${p.identifier}`);
            },
            intent: 'primary',
            label: 'Go to democracy proposal',
            fluid: true,
            rounded: true,
          }),
        ])),
        referenda.map((r) => m('.treasury-embed-section', [
          m('strong', [
            `Referendum ${r.identifier}`,
          ]),
          m('p', [
            r.preimage?.method === 'approveProposal' && 'Approves this proposal',
            r.preimage?.method === 'rejectProposal' && 'Rejects this proposal',
          ]),
          app.activeChainId() && m(Button, {
            href: `/${app.activeChainId()}/proposal/referendum/${r.identifier}`,
            onclick: (e) => {
              e.preventDefault();
              m.route.set(`/${app.activeChainId()}/proposal/referendum/${r.identifier}`);
            },
            intent: 'primary',
            label: 'Go to referendum',
            fluid: true,
            rounded: true,
          }),
        ])),
        councilMotions.map((mo) => m('.treasury-embed-section', [
          m('strong', [
            `Council Motion ${mo.shortIdentifier}`,
          ]),
          m('p', [
            mo.call?.method === 'approveProposal' && 'Approves this proposal',
            mo.call?.method === 'rejectProposal' && 'Rejects this proposal',
          ]),
          app.activeChainId() && m(Button, {
            href: `/${app.activeChainId()}/proposal/councilmotion/${mo.identifier}`,
            onclick: (e) => {
              e.preventDefault();
              m.route.set(`/${app.activeChainId()}/proposal/councilmotion/${mo.identifier}`);
            },
            intent: 'primary',
            label: 'Go to motion',
            fluid: true,
            rounded: true,
          }),
        ])),
      ]);
    }
  }
};

export default TreasuryEmbed;
