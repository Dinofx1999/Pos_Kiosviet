import { Module } from '@nestjs/common';
import { CashbookController, PaymentsController } from './finance.controller';
import { CashbookService } from './cashbook.service';
import { BankTransfersController, SepayConfigController, SepayWebhookController } from './bank-transfers.controller';
import { BankTransfersService } from './bank-transfers.service';
import { LedgerService } from './ledger.service';
import { PaymentsService } from './payments.service';

@Module({ controllers: [PaymentsController, CashbookController, SepayConfigController, BankTransfersController, SepayWebhookController], providers: [LedgerService, PaymentsService, CashbookService, BankTransfersService], exports: [LedgerService, PaymentsService, CashbookService, BankTransfersService] })
export class FinanceModule {}
