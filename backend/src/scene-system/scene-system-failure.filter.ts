import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";

import { SceneSystemFailure } from "./scene-system.service.js";

@Catch(SceneSystemFailure)
export class SceneSystemFailureFilter implements ExceptionFilter {
  catch(exception: SceneSystemFailure, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(exception.status).json({
      code: exception.code,
      error: exception.message,
    });
  }
}
