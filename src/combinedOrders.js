const process = require('node:process');

require('dotenv').config();

const fetchCombinedOrders = require('./services/combinedOrdersFetcher');

const run = async () => {
  try {
    const data = await fetchCombinedOrders(process.env);
    const { rozetka, keycrm, association, matches } = data;

    console.log('Rozetka latest order:');
    if (rozetka.order) {
      console.dir(rozetka.order, { depth: null });
    } else {
      console.log('Rozetka order not found.');
    }

    console.log('');

    if (keycrm.matchedOrder) {
      const { field, value } = keycrm.matchInfo || {};
      const matchLabel = field && value ? `matched by ${field} = ${value}` : 'matched order';
      console.log(`KeyCRM ${matchLabel}:`);
      console.dir(keycrm.matchedOrder, { depth: null });
    } else if (keycrm.fallbackOrder) {
      console.log(
        'KeyCRM matching order not found. Showing latest KeyCRM order instead:'
      );
      console.dir(keycrm.fallbackOrder, { depth: null });
    } else {
      console.log('KeyCRM order not found.');
    }

    if (association) {
      console.log('');
      console.log('Primary association:');
      console.dir(association, { depth: null });
    }

    if (matches) {
      const stats = matches.stats || {};
      console.log('');
      console.log(
        `Match stats: Rozetka=${stats.rozetkaCount ?? 0}, KeyCRM=${
          stats.keycrmCount ?? 0
        }, paired=${stats.pairedCount ?? 0}, unmatched Rozetka=${
          stats.unmatchedRozetkaCount ?? 0
        }, unmatched KeyCRM=${stats.unmatchedKeycrmCount ?? 0}`
      );

      if (matches.pairs && matches.pairs.length > 0) {
        console.log('');
        console.log('Matched pairs:');
        matches.pairs.forEach((pair, index) => {
          const roId =
            pair.rozetkaOrder?.id ?? pair.rozetkaOrder?.order_id ?? '—';
          const keyId =
            pair.keycrmOrder?.id ??
            pair.keycrmOrder?.order_id ??
            pair.keycrmOrder?.number ??
            '—';
          const label = pair.matchField
            ? `${pair.matchField}=${pair.matchValue}`
            : 'match';
          console.log(`${index + 1}. Rozetka #${roId} ↔ KeyCRM #${keyId} (${label})`);
        });
      }

      if (matches.unmatchedRozetka && matches.unmatchedRozetka.length > 0) {
        console.log('');
        console.log(
          `Rozetka orders without match (${matches.unmatchedRozetka.length}):`
        );
        matches.unmatchedRozetka.forEach((entry, index) => {
          const id = entry.order?.id ?? entry.order?.order_id ?? '—';
          console.log(`  ${index + 1}. Rozetka #${id}`);
        });
      }

      if (matches.unmatchedKeycrm && matches.unmatchedKeycrm.length > 0) {
        console.log('');
        console.log(
          `KeyCRM orders without match (${matches.unmatchedKeycrm.length}):`
        );
        matches.unmatchedKeycrm.forEach((order, index) => {
          const id = order?.id ?? order?.order_id ?? order?.number ?? '—';
          console.log(`  ${index + 1}. KeyCRM #${id}`);
        });
      }
    }
  } catch (error) {
    if (error.response) {
      const { status, data } = error.response;
      console.error('Combined orders API error', status, data);
      return;
    }

    console.error('Failed to fetch combined orders:', error.message);
    process.exitCode = 1;
  }
};

run();
