const process = require('node:process');

require('dotenv').config();

const { syncLatestRozetkaLink } = require('../services/rozetkaLinkSync');

const run = async () => {
  try {
    const result = await syncLatestRozetkaLink(process.env);

    if (!result.updated) {
      console.log(result.reason || 'Nothing to update.');
      return;
    }

    console.log(
      `Updated KeyCRM order ${result.keycrmOrderId} field ${result.fieldUuid} with URLs: ${result.value}`
    );
  } catch (error) {
    if (error.response) {
      const { status, data } = error.response;
      console.error('KeyCRM API error', status, data);
      process.exitCode = 1;
      return;
    }

    console.error('Failed to sync Rozetka link:', error.message);
    process.exitCode = 1;
  }
};

run();
