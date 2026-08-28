import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import { Response } from "express";

import { WalletFailure } from "./wallet.failure.js";

@Catch(WalletFailure)
export class WalletFailureFilter implements ExceptionFilter {
  catch(exception: WalletFailure, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(exception.statusCode).json({
      error: exception.message,
      code: exception.code,
      statusCode: exception.statusCode,
    });
  }
}
