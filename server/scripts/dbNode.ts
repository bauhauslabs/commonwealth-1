/* eslint-disable no-continue */
import { Pool } from 'pg';
import _ from 'underscore';
import format from 'pg-format';
import {
  createListener,
  chainSupportedBy,
  SubstrateTypes,
  SubstrateEvents
} from '@commonwealth/chain-events';

import {
  RabbitMqHandler,
} from '@commonwealth/ce-rabbitmq-plugin';
import Identity from '../eventHandlers/pgIdentity';
import { factory, formatFilename } from '../../shared/logging';
import { DATABASE_URI, HANDLE_IDENTITY } from '../config';
import RabbitMQConfig from '../util/rabbitmq/RabbitMQConfig';
import { ChainAttributes } from '../models/chain';

const log = factory.getLogger(formatFilename(__filename));

// TODO: RollBar error reporting

// the number of the current worker
const WORKER_NUMBER: number = Number(process.env.WORKER_NUMBER) || 0;

// the total number of workers
const NUM_WORKERS: number = Number(process.env.NUM_WORKERS) || 1;

// The number of minutes to wait between each run -- rounded to the nearest whole number
const REPEAT_TIME = Math.round(Number(process.env.REPEAT_TIME)) || 1;

// counts the number of errors occurring for each chain
// - resets every 24 hours (to remove any temporary connection errors)
// this is only meant to stop a chain from repeatedly causing errors every REPEAT_TIME
let chainErrors: { [chain: string]: number } = {};

// counts the number of mainProcess runs
let runCount = 0;

// stores all the listeners a dbNode has active
const listeners: { [key: string]: any} = {};

// any fatal error is handle through here
async function handleFatalError(error: Error, pool, chain?: string, type?: string): Promise<void> {
  log.error(`${chain ? `[${chain}]: ` : ''}${String(error)}`);

  if (chain && chain !== 'erc20' && chainErrors[chain] >= 4) {
    listeners[chain].unsubscribe();
    delete listeners[chain];

    const query = format('UPDATE "Chains" SET "has_chain_events_listener"=\'false\' WHERE "id"=%L', chain);
    try {
      pool.query(query);
    } catch (err) {
      log.fatal(`Unable to disabled ${chain}`);
    }
  } else if (chain) ++chainErrors[chain];
}

// the function that executes every REPEAT_TIME
async function mainProcess(producer: RabbitMqHandler, pool: Pool) {
  // reset the chainError counts at the end of every day
  if (runCount > 1440 / REPEAT_TIME) {
    runCount = 1;
    chainErrors = {};
  } else {
    ++runCount;
  }

  log.info('Starting scheduled process');

  // eslint-disable-next-line max-len
  let query = 'SELECT "Chains"."id", "substrate_spec", "url", "address", "base", "type", "network" FROM "Chains" JOIN "ChainNodes" ON "Chains"."id"="ChainNodes"."chain" WHERE "Chains"."has_chain_events_listener"=\'true\';';
  const allChains = (await pool.query(query)).rows;

  // gets the chains specific to this node
  let myChainData = allChains.filter(
    (chain, index) => index % NUM_WORKERS === WORKER_NUMBER
  );

  // passed to listeners that support it
  const discoverReconnectRange = async (chain: string) => {
    let latestBlock;
    try {
      // eslint-disable-next-line max-len
      const eventTypes = (await pool.query(format('SELECT "id" FROM "ChainEventTypes" WHERE "chain"=%L', chain))).rows.map((obj) => obj.id);
      if (eventTypes.length === 0) {
        log.info(`[${chain}]: No events in database to get last block number from`);
        return { startBlock: null };
      }
      // eslint-disable-next-line max-len
      latestBlock = (await pool.query(format('SELECT MAX("block_number") FROM "ChainEvents" WHERE "chain_event_type_id" IN (%L)', eventTypes))).rows;
    } catch (error) {
      log.warn(`[${chain}]: An error occurred while discovering offline time range`, error);
    }
    if (latestBlock && latestBlock.length > 0 && latestBlock[0] && latestBlock[0].max) {
      const lastEventBlockNumber = latestBlock[0].max;
      log.info(`[${chain}]: Discovered chain event in db at block ${lastEventBlockNumber}.`);
      return { startBlock: lastEventBlockNumber + 1 };
    } else {
      return { startBlock: null };
    }
  };

  // group erc20 tokens together in order to start only one listener for all erc20 tokens
  const erc20Tokens = myChainData.filter((chain) => chain.type === 'token' && chain.base === 'ethereum');
  const erc20TokenAddresses = erc20Tokens.map((chain) => chain.address);
  const erc20TokenNames = erc20Tokens.map((chain) => chain.id);

  // don't start a new erc20 listener if it is causing errors
  if (!chainErrors['erc20'] || chainErrors['erc20'] < 4) {
    // start a listener if: it doesn't exist yet OR it exists but the tokens have changed
    if (erc20Tokens.length > 0
        && (!listeners['erc20']
        || (listeners['erc20']
        && !_.isEqual(erc20TokenAddresses, listeners['erc20'].options.tokenAddresses)))) {
      // clear the listener if it already exists and the tokens have changed
      if (listeners['erc20']) {
        listeners['erc20'].unsubscribe();
        delete listeners['erc20'];
      }

      // start a listener
      log.info(`Starting listener for ${erc20TokenNames}...`);
      try {
        listeners['erc20'] = await createListener('erc20', {
          url: 'wss://mainnet.infura.io/ws',
          tokenAddresses: erc20TokenAddresses,
          tokenNames: erc20TokenNames,
          verbose: false
        }, 'erc20');

        // add the rabbitmq handler for this chain
        listeners['erc20'].eventHandlers['rabbitmq'] = { handler: producer };
      } catch (error) {
        delete listeners['erc20'];
        await handleFatalError(error, pool, 'erc20', 'listener-startup');
      }

      // if listener has started at this point then subscribe
      if (listeners['erc20']) {
        try {
          // subscribe to the chain to begin listening for events
          await listeners['erc20'].subscribe();
        } catch (error) {
          await handleFatalError(error, pool, 'erc20', 'listener-subscribe');
        }
      }
    } else if (listeners['erc20'] && erc20Tokens.length === 0) {
      // delete the listener if there are no tokens to listen to
      log.info('[erc20]: Deleting erc20 listener...');
      listeners['erc20'].unsubscribe();
      delete listeners['erc20'];
    }
  } else {
    log.fatal('[erc20]: There are outstanding errors that need to be resolved before creating a new erc20 listener!');
  }

  // remove erc20 tokens from myChainData
  myChainData = myChainData.filter((chain) => chain.type !== 'token' || chain.base !== 'ethereum');

  // delete listeners for chains that are no longer assigned to this node (skip erc20)
  const myChains = myChainData.map((row) => row.id);
  Object.keys(listeners).forEach((chain) => {
    if (!myChains.includes(chain) && chain !== 'erc20') {
      log.info(`[${chain}]: Deleting chain...`);
      if (listeners[chain]) listeners[chain].unsubscribe();
      delete listeners[chain];
    }
  });

  // initialize listeners first (before dealing with identity)
  for (const chain of myChainData) {
    // start listeners that aren't already created or subscribed - this means for any duplicate chain nodes
    // it will start a listener for the first successful chain node url in the db
    if (!listeners[chain.id] || !listeners[chain.id].subscribed) {
      log.info(`Starting listener for ${chain.id}...`);

      // base is used to override built-in event chains in chain-events - only used for substrate chains in this case
      // NOTE: All erc20 tokens (type='token' base='ethereum') are removed at this point
      let base: string;
      if (chain.base === 'substrate') base = 'substrate';
      else if (chain.network === 'compound') base = 'compound';
      else if (chain.network === 'aave') base = 'aave';

      try {
        listeners[chain.id] = await createListener(chain.id, {
          address: chain.address,
          archival: false,
          url: chain.url,
          spec: chain.substrate_spec,
          skipCatchup: false,
          verbose: false,
          enricherConfig: { balanceTransferThresholdPermill: 10_000 },
          discoverReconnectRange
        }, base);
      } catch (error) {
        delete listeners[chain.id];
        await handleFatalError(error, pool, chain, 'listener-startup');
        continue;
      }

      // if chain is a substrate chain add the excluded events
      let excludedEvents = [];
      if (chainSupportedBy(chain.id, SubstrateTypes.EventChains))
        excludedEvents = [
          SubstrateTypes.EventKind.Reward,
          SubstrateTypes.EventKind.TreasuryRewardMinting,
          SubstrateTypes.EventKind.TreasuryRewardMintingV2,
          SubstrateTypes.EventKind.HeartbeatReceived
        ];

      // add the rabbitmq handler for this chain
      listeners[chain.id].eventHandlers['rabbitmq'] = {
        handler: producer,
        excludedEvents
      };

      try {
        // subscribe to the chain to begin listening for events
        await listeners[chain.id].subscribe();
      } catch (error) {
        await handleFatalError(error, pool, chain.id, 'listener-subscribe');
      }
    } else if (
      chain.base === 'substrate'
      && !_.isEqual(chain.substrate_spec, (<SubstrateEvents.Listener>listeners[chain.id]).options.spec)
    ) {
      // restart the listener if specs were updated (only substrate chains)
      log.info(`Spec for ${chain.id} changed... restarting listener`);
      try {
        await (<SubstrateEvents.Listener>listeners[chain.id]).updateSpec(chain.substrate_spec);
      } catch (error) {
        await handleFatalError(error, pool, chain.id, 'update-spec');
      }
    }
  }

  if (HANDLE_IDENTITY == null) {
    log.info('Finished scheduled process.');
    if (process.env.TESTING) {
      const listenerOptions = {};
      for (const chain of Object.keys(listeners)) {
        listenerOptions[chain] = listeners[chain].options;
      }
      log.info(`Listener Validation:${JSON.stringify(listenerOptions)}`);
    }
    return;
  }

  // loop through chains that have active listeners again this time dealing with identity
  for (const chain of myChainData) {
    // skip chains that aren't Substrate chains
    if (chain.base !== 'substrate') continue;

    if (!listeners[chain.id]) {
      log.warn(`There is no active listener for ${chain.id} - cannot fetch identity`);
      continue;
    }

    log.info(`Fetching identities on ${chain.id}`);

    let identitiesToFetch;
    try {
      // fetch identities to fetch on this chain
      query = format(
        'SELECT * FROM "IdentityCaches" WHERE "chain"=%L;',
        chain.id
      );
      identitiesToFetch = (await pool.query(query)).rows.map(
        (c) => c.address
      );
    } catch (error) {
      await handleFatalError(error, pool, chain.id, 'get-identity-cache');
      continue;
    }

    // if no identities are cached go to next chain
    if (identitiesToFetch.length === 0) {
      log.info(`No identities to fetch for ${chain.id}`);
      continue;
    }

    let identityEvents;
    try {
      // get identity events using the storage fetcher
      identityEvents = await listeners[
        chain.id
      ].storageFetcher.fetchIdentities(identitiesToFetch);
    } catch (error) {
      await handleFatalError(error, pool, chain.id, 'fetch-chain-identities');
      continue;
    }

    // if no identity events are found the go to next chain
    if (identityEvents.length === 0) {
      log.info(`No identity events for ${chain.id}`);
      continue;
    }

    if (HANDLE_IDENTITY === 'handle') {
      // initialize identity handler
      const identityHandler = new Identity(pool);

      await Promise.all(
        identityEvents.map((e) => identityHandler.handle(e, null))
      );
    } else if (HANDLE_IDENTITY === 'publish') {
      for (const event of identityEvents) {
        event.chain = chain.id; // augment event with chain
        await producer.publish(event, 'identityPub');
      }
    }

    // clear the identity cache for this chain
    try {
      query = format('DELETE FROM "IdentityCaches" WHERE "chain"=%L;', chain.id);
      await pool.query(query);
    } catch (error) {
      await handleFatalError(error, pool, chain.id, 'clear-identity-cache');
      continue;
    }

    log.info(`Identity cache for ${chain.id} cleared`);
  }

  log.info('Finished scheduled process.');
  if (process.env.TESTING) {
    const listenerOptions = {};
    for (const chain of Object.keys(listeners)) {
      listenerOptions[chain] = listeners[chain].options;
    }
    log.info(`Listener Validation:${JSON.stringify(listenerOptions)}`);
  }
}

// begin process
log.info('db-node initialization');

const producer = new RabbitMqHandler(RabbitMQConfig);
const pool = new Pool({
  connectionString: DATABASE_URI,
  ssl: {
    rejectUnauthorized: false
  },
  max: 3
});

pool.on('error', (err, client) => {
  log.error('Unexpected error on idle client', err);
});

producer
  .init()
  .then(() => {
    return mainProcess(producer, pool);
  })
  .then(() => {
    setInterval(mainProcess, REPEAT_TIME * 60000, producer, pool);
  })
  .catch((err) => {
    // TODO: any error caught here is critical - no events will be produced
    handleFatalError(err, pool, null, 'unknown');
  });
