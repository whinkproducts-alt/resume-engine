import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import * as mammoth from 'mammoth';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors/app-error';
import type { AuthUser } from '../auth/auth.types';
import { CreateJdDto } from './dto/create-jd.dto';

const MIN_JD_CHARS = 200;

@Injectable()
export class JdsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    user: AuthUser,
    dto: CreateJdDto,
    file?: Express.Multer.File,
  ) {
    const profile = await this.prisma.profile.findFirst({
      where: { id: dto.profileId, userId: user.id },
    });
    if (!profile) throw new AppError('PROFILE_NOT_FOUND', 404);

    const pastedText = dto.rawText ?? dto.text;
    const sourceUrl = dto.sourceUrl ?? dto.url;
    const sourceType = file ? 'file' : dto.sourceType;
    if (!sourceType) {
      throw new AppError('SOURCE_TYPE_REQUIRED', 400, 'sourceType is required.');
    }

    let text: string;
    if (sourceType === 'paste') {
      if (!pastedText) throw new AppError('JD_TEXT_REQUIRED', 400);
      text = pastedText;
    } else if (sourceType === 'url') {
      if (!sourceUrl) throw new AppError('JD_URL_REQUIRED', 400);
      text = await this.fetchUrlText(sourceUrl);
    } else {
      if (!file) throw new AppError('JD_FILE_REQUIRED', 400);
      text = await this.fileText(file);
    }

    text = this.normalize(text);
    if (text.length < MIN_JD_CHARS) {
      throw new AppError(
        'JD_UNUSABLE',
        422,
        `Extracted job description must contain at least ${MIN_JD_CHARS} characters.`,
      );
    }

    const jd = await this.prisma.jobDescription.create({
      data: {
        userId: user.id,
        profileId: profile.id,
        sourceType,
        sourceUrl: sourceType === 'url' ? (sourceUrl ?? null) : null,
        sourceFileName: file?.originalname ?? null,
        rawText: text,
        extractedChars: text.length,
        status: 'EXTRACTED',
      },
    });

    return {
      id: jd.id,
      status: jd.status,
      sourceType: jd.sourceType,
      extractedChars: jd.extractedChars,
      createdAt: jd.createdAt,
    };
  }

  async findOne(user: AuthUser, id: string) {
    const jd = await this.prisma.jobDescription.findFirst({
      where: { id, userId: user.id },
    });
    if (!jd) throw new AppError('JD_NOT_FOUND', 404);
    return jd;
  }

  private async fetchUrlText(rawUrl: string): Promise<string> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new AppError('INVALID_URL', 400, 'Invalid URL.');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new AppError('INVALID_URL', 400, 'Only http/https URLs are supported.');
    }

    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'ResumeEngineBot/1.0' },
    });
    if (!res.ok) {
      throw new AppError('URL_FETCH_FAILED', 422, `URL returned ${res.status}.`);
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, noscript, svg').remove();
    return $('body').text();
  }

  private async fileText(file: Express.Multer.File): Promise<string> {
    const name = file.originalname.toLowerCase();
    if (name.endsWith('.docx')) {
      const { value } = await mammoth.extractRawText({ buffer: file.buffer });
      return value;
    }
    if (name.endsWith('.txt')) {
      return file.buffer.toString('utf8');
    }
    throw new AppError(
      'UNSUPPORTED_FILE',
      422,
      'Only .docx and .txt files are supported.',
    );
  }

  private normalize(input: string): string {
    return input
      .replace(/\r\n/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
