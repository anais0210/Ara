import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  GoneException,
  HttpStatus,
  NotFoundException,
  Param,
  ParseFilePipeBuilder,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiCreatedResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Audit } from 'src/generated/nestjs-dto/audit.entity';
import { CriterionResult } from 'src/generated/nestjs-dto/criterionResult.entity';
import { MailerService } from 'src/mailer.service';
import { AuditService } from './audit.service';
import { CreateAuditDto } from './create-audit.dto';
import { UpdateAuditDto } from './update-audit.dto';
import { UpdateResultsDto } from './update-results.dto';
import { UploadImageDto } from './upload-image.dto';

@Controller('audits')
@ApiTags('Audits')
export class AuditsController {
  constructor(
    private readonly auditService: AuditService,
    private readonly mailer: MailerService,
  ) {}

  /** Save a new audit into the database. */
  @Post()
  @ApiCreatedResponse({
    description: 'The audit has been successfully created.',
    type: Audit,
  })
  async createAudit(@Body() body: CreateAuditDto) {
    const audit = await this.auditService.createAudit(body);
    // FIXME: the whole requests fails if the mail fails to send properly
    // await this.mailer.sendAuditCreatedMail(audit);
    return audit;
  }

  /** Retrieve an audit from the database. */
  @Get('/:uniqueId')
  @ApiOkResponse({ description: 'The audit was found.', type: Audit })
  @ApiNotFoundResponse({ description: 'The audit does not exist.' })
  @ApiGoneResponse({ description: 'The audit has been previously deleted.' })
  async getAudit(@Param('uniqueId') uniqueId: string) {
    const audit = await this.auditService.getAuditWithEditUniqueId(uniqueId);

    if (!audit) {
      return this.sendAuditNotFoundStatus(uniqueId);
    }

    return audit;
  }

  /** Update an audit data in the database. */
  @Put('/:uniqueId')
  @ApiOkResponse({
    description: 'The audit has been successfully updated',
    type: Audit,
  })
  @ApiNotFoundResponse({ description: 'The audit does not exist.' })
  @ApiGoneResponse({ description: 'The audit has been previously deleted.' })
  async updateAudit(
    @Param('uniqueId') uniqueId: string,
    @Body() body: UpdateAuditDto,
  ) {
    const audit = await this.auditService.updateAudit(uniqueId, body);

    if (!audit) {
      return this.sendAuditNotFoundStatus(uniqueId);
    }

    return audit;
  }

  @Post('/:uniqueId/results/examples')
  @UseInterceptors(FileInterceptor('image'))
  async uploadExampleImage(
    @Param('uniqueId') uniqueId: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({
          fileType: 'image',
        })
        .addMaxSizeValidator({
          maxSize: 2000000,
        })
        .build({
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        }),
    )
    file: Express.Multer.File,
    @Body() body: UploadImageDto,
  ) {
    const audit = await this.auditService.getAuditWithEditUniqueId(uniqueId);

    if (!audit) {
      return this.sendAuditNotFoundStatus(uniqueId);
    }

    return await this.auditService.saveExampleImage(
      uniqueId,
      body.pageId,
      body.topic,
      body.criterium,
      file,
    );
  }

  @Delete('/:uniqueId/results/examples/:exampleId')
  async deleteExampleImage(
    @Param('uniqueId') uniqueId: string,
    @Param('exampleId', new ParseIntPipe()) exampleId: number,
  ) {
    const deleted = await this.auditService.deleteExampleImage(
      uniqueId,
      Number(exampleId),
    );

    if (!deleted) {
      throw new NotFoundException();
    }
  }

  /** Retrieve the results of an audit (compliance data) from the database. */
  @Get('/:uniqueId/results')
  @ApiOkResponse({ type: [CriterionResult] })
  @ApiNotFoundResponse({ description: 'The audit does not exist.' })
  @ApiGoneResponse({ description: 'The audit has been previously deleted.' })
  async getAuditResults(@Param('uniqueId') uniqueId: string) {
    const results = await this.auditService.getResultsWithEditUniqueId(
      uniqueId,
    );

    if (!results) {
      return this.sendAuditNotFoundStatus(uniqueId);
    }

    return results;
  }

  /** Update the compliance data of an audit. */
  @Patch('/:uniqueId/results')
  @ApiOkResponse({
    description: 'The audit results have been successfully updated.',
  })
  @ApiNotFoundResponse({ description: 'The audit does not exist.' })
  @ApiGoneResponse({ description: 'The audit has been previously deleted.' })
  async updateAuditResults(
    @Param('uniqueId') uniqueId: string,
    @Body() body: UpdateResultsDto,
  ) {
    const audit = await this.auditService.getAuditWithEditUniqueId(uniqueId);

    if (!audit) {
      return this.sendAuditNotFoundStatus(uniqueId);
    }

    await this.auditService.updateResults(uniqueId, body);
  }

  /** Flag an audit as "published", completed. */
  @Put('/:uniqueId/publish')
  @ApiOkResponse({ type: Audit })
  @ApiNotFoundResponse({ description: 'The audit does not exist.' })
  @ApiGoneResponse({ description: 'The audit has been previously deleted.' })
  async publishAudit(@Param('uniqueId') uniqueId: string) {
    const auditIsComplete = await this.auditService.isAuditComplete(uniqueId);
    if (!auditIsComplete) {
      throw new ConflictException(
        'Cannot publish audit if it is not complete.',
      );
    }

    const audit = await this.auditService.publishAudit(uniqueId);

    if (!audit) {
      return this.sendAuditNotFoundStatus(uniqueId);
    }

    return audit;
  }

  /** Delete an audit from the database. */
  @Delete('/:uniqueId')
  @ApiOkResponse({ description: 'The audit has been successfully deleted.' })
  @ApiNotFoundResponse({ description: 'The audit does not exist.' })
  @ApiGoneResponse({ description: 'The audit has been previously deleted.' })
  async deleteAudit(@Param('uniqueId') uniqueId: string) {
    const deleted = await this.auditService.deleteAudit(uniqueId);

    if (!deleted) {
      return this.sendAuditNotFoundStatus(uniqueId);
    }
  }

  /**
   * Send 404 (Not Found) status for audits that never existed
   * and 410 (Gone) for audits that existed but were deleted.
   */
  private async sendAuditNotFoundStatus(editUniqueId: string) {
    if (await this.auditService.checkIfAuditWasDeleted(editUniqueId)) {
      throw new GoneException();
    } else {
      throw new NotFoundException();
    }
  }
}
