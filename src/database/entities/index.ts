export {Account} from "./account.entity";
export {AiImportLog} from "./ai-import-log.entity";
export {Category} from "./category.entity";
export {IdempotencyKey} from "./idempotency-key.entity";
export {Merchant} from "./merchant.entity";
export {RecurringOccurrence} from "./recurring-occurrence.entity";
export {RecurringRule} from "./recurring-rule.entity";
export {SummaryInsight} from "./summary-insight.entity";
export {Transaction} from "./transaction.entity";
export {User} from "./user.entity";

import {Account} from "./account.entity";
import {AiImportLog} from "./ai-import-log.entity";
import {Category} from "./category.entity";
import {IdempotencyKey} from "./idempotency-key.entity";
import {Merchant} from "./merchant.entity";
import {RecurringOccurrence} from "./recurring-occurrence.entity";
import {RecurringRule} from "./recurring-rule.entity";
import {SummaryInsight} from "./summary-insight.entity";
import {Transaction} from "./transaction.entity";
import {User} from "./user.entity";

/** Every entity mapped to the shared SQLite schema. */
export const ENTITIES = [User, Account, Category, Merchant, Transaction, RecurringRule, RecurringOccurrence, AiImportLog, SummaryInsight, IdempotencyKey];
