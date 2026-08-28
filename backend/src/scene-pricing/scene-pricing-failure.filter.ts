import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";

import { ScenePricingFailure } from "./scene-pricing.service.js";

@Catch(ScenePricingFailure)
export class ScenePricingFailureFilter implements ExceptionFilter {
  catch(exception: ScenePricingFailure, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(exception.status).json({
      code: exception.code,
      error: exception.message,
    });
  }
}
