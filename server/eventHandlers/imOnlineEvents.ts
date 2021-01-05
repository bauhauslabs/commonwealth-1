import { IEventHandler, CWEvent, IChainEventData, SubstrateTypes } from '@commonwealth/chain-events';
import Sequelize from 'sequelize';
import { sequelize } from '../database';
const Op = Sequelize.Op;


const uptimePercent = (noOfTrues: number, noOfFalse: number, currentEventType: number) => {
  /*
    This formula is used to calculate the uptime percentage of the validators based on previous sessions' uptime.
    upTimePercentage = ((No. isOnline True(s) + Current Execution Mode [1 for AllGood, 0 for SomeOffline]) /
                        (No. isOnline True(s) + No. isOnline False(s))) * 100
  */
  const upTimePercentage = (((noOfTrues + currentEventType) / (noOfTrues + noOfFalse)) * 100)
    .toFixed(2);

  return upTimePercentage;
};

export default class extends IEventHandler {
  constructor(
    private readonly _models
  ) {
    super();
  }
  public async handle(event: CWEvent < IChainEventData >, dbEvent) {
    // 1) if other event type ignore and do nothing.
    if (event.data.kind !== SubstrateTypes.EventKind.AllGood
      && event.data.kind !== SubstrateTypes.EventKind.SomeOffline) {
      return dbEvent;
    }

    const imOnlineEventData = event.data;
    let eventValidatorsList: string | any[];
    if (event.data.kind === SubstrateTypes.EventKind.SomeOffline) {
      eventValidatorsList = imOnlineEventData.validators?.map((validator) => JSON.parse(validator)[0]);
    } else {
      eventValidatorsList = imOnlineEventData.validators;
    }

    // ignore validators who were offline but there record is not available in validators table.
    const existingValidators = await this._models.Validator.findAll({
      where: {
        stash: {
          [Op.in]: eventValidatorsList
        }
      }
    });
    if (!existingValidators || existingValidators.length === 0) return dbEvent;

    // 2) Get relevant data from DB for processing.
    /*
      This query will return the last created record for validators in 'HistoricalValidatorStatistic' 
      table and return the data for each validator with there onlineCount and offlineCount counts if any.
      since all new and active validators records has been created by new-session event handler, 
      it'll return the the last created records of them.
    */
    const rawQuery = `
      SELECT *
      FROM( 
        SELECT * ,ROW_NUMBER() OVER( PARTITION BY partitionTable.stash ORDER BY created_at DESC ) 
        FROM public."HistoricalValidatorStatistic" as partitionTable
        JOIN( 
          SELECT stash, SUM(case when "isOnline" then 1 else 0 end) as "onlineCount", 
          SUM(case when "isOnline"  then 0 else 1 end) as "offlineCount" 
          FROM public."HistoricalValidatorStatistic" as groupTable 
          where "eventType" in ('all-good', 'some-offline') GROUP by groupTable.stash
          ) joinTable
        ON joinTable.stash = partitionTable.stash
        WHERE partitionTable.stash IN ('${eventValidatorsList.join("','")}')
        )  as validatorQuery
      WHERE  validatorQuery.row_number = 1
    `;
    const [validators, metadata] = await sequelize.query(rawQuery);
    const validatorsList = JSON.parse(JSON.stringify(validators));

    // 3) Modify uptime for validators.
    switch (imOnlineEventData.kind) {
      case SubstrateTypes.EventKind.AllGood: {
        validatorsList.forEach((validator: any) => {
          validator.uptime = uptimePercent(
            Number(validator.onlineCount),
            Number(validator.offlineCount),
            1 // 1 for AllGood event
          ).toString();
          validator.isOnline = true;
        });
        break;
      }
      case SubstrateTypes.EventKind.SomeOffline: {
        validatorsList.forEach((validator: any) => {
          validator.uptime = uptimePercent(
            Number(validator.onlineCount),
            Number(validator.offlineCount),
            0  // 0 for SomeOffline event
          ).toString();
          validator.isOnline = false;
        });
        break;
      }
      default: {
        return dbEvent;
      }
    }
    validatorsList.forEach((validator: any) => {
      validator.block = event.blockNumber.toString();
      validator.eventType = imOnlineEventData.kind;
      validator.created_at = new Date().toISOString();
      validator.updated_at = new Date().toISOString();
      delete validator.id;
      delete validator.onlineCount;
      delete validator.offlineCount;
      delete validator.row_number;
    });

    // 4) create/update event data in database.
    // await this._models.HistoricalValidatorStatistic.bulkCreate( validatorsList, {ignoreDuplicates: true} );
    await Promise.all(validatorsList.map((row: any) => {
      return this._models.HistoricalValidatorStatistic.create(row);
    }));

    return dbEvent;
  }
}
