import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";

import { SceneGuideFailure } from "./scene-guide.policy.js";

@Catch(SceneGuideFailure)
export class SceneGuideFailureFilter implements ExceptionFilter {
  catch(exception: SceneGuideFailure, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(exception.status).json({
      code: exception.code,
      error: exception.message,
    });
  }
}
