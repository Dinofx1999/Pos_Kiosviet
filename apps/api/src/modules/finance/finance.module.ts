import { Module } from '@nestjs/common';
import { CashbookController, PaymentsController } from './finance.controller';
import { CashbookService } from './cashbook.service';
import { LedgerService } from './ledger.service';
import { PaymentsService } from './payments.service';

@Module({ controllers: [PaymentsController, CashbookController], providers: [LedgerService, PaymentsService, CashbookService], exports: [LedgerService, PaymentsService, CashbookService] })
export class FinanceModule {}
