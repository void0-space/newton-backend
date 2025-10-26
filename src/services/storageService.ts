import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { FastifyInstance } from 'fastify';
import { createId } from '@paralleldrive/cuid2';
import sharp from 'sharp';
import mime from 'mime-types';
import path from 'path';
import { Readable } from 'stream';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import ffmpeg from 'fluent-ffmpeg';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface UploadOptions {
  organizationId: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface MediaMetadata {
  id: string;
  organizationId: string;
  filename: string;
  originalName: string;
  contentType: string;
  size: number;
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
}

export class StorageService {
  private s3Client: S3Client;
  private bucket: string;
  private fastify: FastifyInstance;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
    this.bucket = process.env.CLOUDFLARE_R2_BUCKET || process.env.S3_BUCKET || 'whatsapp-media';

    // Configure for Cloudflare R2 or fallback to S3-compatible storage
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const endpoint = accountId
      ? `https://${accountId}.r2.cloudflarestorage.com`
      : process.env.S3_ENDPOINT;

    this.s3Client = new S3Client({
      endpoint,
      region: process.env.CLOUDFLARE_R2_REGION || process.env.S3_REGION || 'auto',
      credentials: {
        accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY || '',
        secretAccessKey:
          process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || process.env.S3_SECRET_KEY || '',
      },
      forcePathStyle: true, // Required for R2 and most S3-compatible services
    });
  }

  async generateUploadUrl(options: UploadOptions): Promise<{
    uploadUrl: string;
    mediaId: string;
    key: string;
  }> {
    const mediaId = createId();
    const extension = path.extname(options.filename) || mime.extension(options.contentType) || '';
    const key = this.generateKey(options.organizationId, mediaId, extension.toString());

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
      ContentLength: options.size,
      Metadata: {
        organizationId: options.organizationId,
        originalName: this.sanitizeMetadata(options.filename),
        mediaId,
      },
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: 3600, // 1 hour
    });

    return {
      uploadUrl,
      mediaId,
      key,
    };
  }

  async generateDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }

  async generateUploadUrl(
    options: {
      organizationId: string;
      filename: string;
      contentType: string;
      size?: number;
    },
    expiresIn = 3600
  ): Promise<{ uploadUrl: string; key: string; mediaId: string }> {
    const extension = path.extname(options.filename) || mime.extension(options.contentType) || '';
    const mediaId = createId();
    const key = this.generateKey(options.organizationId, mediaId, extension.toString());

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
      Metadata: {
        organizationId: options.organizationId,
        originalName: this.sanitizeMetadata(options.filename),
        mediaId: mediaId,
      },
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn });

    return { uploadUrl, key, mediaId };
  }

  async uploadBuffer(
    buffer: Buffer,
    options: UploadOptions & { key?: string }
  ): Promise<{ key: string; url: string }> {
    const extension = path.extname(options.filename) || mime.extension(options.contentType) || '';
    const key =
      options.key || this.generateKey(options.organizationId, createId(), extension.toString());

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: options.contentType,
      Metadata: {
        organizationId: options.organizationId,
        originalName: this.sanitizeMetadata(options.filename),
      },
    });

    await this.s3Client.send(command);

    const url = await this.generateDownloadUrl(key);
    return { key, url };
  }

  async uploadStream(
    stream: Readable,
    options: UploadOptions & { key?: string }
  ): Promise<{ key: string; url: string }> {
    const extension = path.extname(options.filename) || mime.extension(options.contentType) || '';
    const key =
      options.key || this.generateKey(options.organizationId, createId(), extension.toString());

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: stream,
      ContentType: options.contentType,
      Metadata: {
        organizationId: options.organizationId,
        originalName: this.sanitizeMetadata(options.filename),
      },
    });

    await this.s3Client.send(command);

    const url = await this.generateDownloadUrl(key);
    return { key, url };
  }

  async getObject(key: string): Promise<{
    stream: Readable;
    metadata: Record<string, string>;
    contentType: string;
    contentLength: number;
  }> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.s3Client.send(command);

    if (!response.Body) {
      throw new Error('Object not found');
    }

    return {
      stream: response.Body as Readable,
      metadata: response.Metadata || {},
      contentType: response.ContentType || 'application/octet-stream',
      contentLength: response.ContentLength || 0,
    };
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.s3Client.send(command);
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  async generateThumbnail(
    imageBuffer: Buffer,
    options: { width?: number; height?: number; quality?: number } = {}
  ): Promise<Buffer> {
    const { width = 200, height = 200, quality = 80 } = options;

    return await sharp(imageBuffer)
      .resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality })
      .toBuffer();
  }

  async processImage(
    buffer: Buffer,
    options: { quality?: number } = {}
  ): Promise<{
    processedBuffer: Buffer;
    originalSize: number;
    compressedSize: number;
    metadata: { width: number; height: number; format: string };
  }> {
    const originalSize = buffer.length;
    const { quality = 85 } = options;

    const image = sharp(buffer);
    const metadata = await image.metadata();

    // Optimize image with compression
    let processedBuffer: Buffer;

    if (metadata.format === 'jpeg' || metadata.format === 'jpg') {
      processedBuffer = await image.jpeg({ quality }).toBuffer();
    } else if (metadata.format === 'png') {
      processedBuffer = await image.png({ quality }).toBuffer();
    } else if (metadata.format === 'webp') {
      processedBuffer = await image.webp({ quality }).toBuffer();
    } else {
      // Convert unsupported formats to JPEG
      processedBuffer = await image.jpeg({ quality }).toBuffer();
    }

    return {
      processedBuffer,
      originalSize,
      compressedSize: processedBuffer.length,
      metadata: {
        width: metadata.width || 0,
        height: metadata.height || 0,
        format: metadata.format || 'jpeg',
      },
    };
  }

  async compressFile(
    buffer: Buffer,
    mimeType: string
  ): Promise<{
    compressedBuffer: Buffer;
    originalSize: number;
    compressedSize: number;
  }> {
    const originalSize = buffer.length;

    // For images, use image-specific compression
    if (this.isImageType(mimeType)) {
      const result = await this.processImage(buffer);
      return {
        compressedBuffer: result.processedBuffer,
        originalSize,
        compressedSize: result.compressedSize,
      };
    }

    // For other files, use gzip compression if beneficial
    // Only compress if file is larger than 1KB and compression saves at least 10%
    if (originalSize < 1024) {
      return {
        compressedBuffer: buffer,
        originalSize,
        compressedSize: originalSize,
      };
    }

    try {
      const compressed = await gzipAsync(buffer);
      const compressionRatio = compressed.length / originalSize;

      // Only use compression if it reduces size by at least 10%
      if (compressionRatio < 0.9) {
        return {
          compressedBuffer: compressed,
          originalSize,
          compressedSize: compressed.length,
        };
      }
    } catch (error) {
      this.fastify.log.warn('File compression failed:', error);
    }

    // Return original if compression not beneficial
    return {
      compressedBuffer: buffer,
      originalSize,
      compressedSize: originalSize,
    };
  }

  async generateVideoThumbnail(
    videoBuffer: Buffer,
    options: {
      width?: number;
      height?: number;
      timeOffset?: number;
    } = {}
  ): Promise<Buffer> {
    const { width = 200, height = 200, timeOffset = 1 } = options;

    try {
      // Create temporary files
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-thumb-'));
      const inputPath = path.join(tempDir, 'input.mp4');
      const outputPath = path.join(tempDir, 'thumb.jpg');

      try {
        // Write input video to temp file
        await fs.writeFile(inputPath, videoBuffer);

        // Generate thumbnail using fluent-ffmpeg
        await new Promise<void>((resolve, reject) => {
          ffmpeg(inputPath)
            .seekInput(timeOffset)
            .frames(1)
            .size(`${width}x${height}`)
            .output(outputPath)
            .on('end', () => resolve())
            .on('error', (err: Error) => reject(err))
            .run();
        });

        // Read the generated thumbnail
        const thumbnailBuffer = await fs.readFile(outputPath);

        // Clean up temp files
        await fs.unlink(inputPath).catch(() => {});
        await fs.unlink(outputPath).catch(() => {});
        await fs.rmdir(tempDir).catch(() => {});

        return thumbnailBuffer;
      } catch (cleanupError) {
        // Ensure cleanup even if processing fails
        await fs.unlink(inputPath).catch(() => {});
        await fs.unlink(outputPath).catch(() => {});
        await fs.rmdir(tempDir).catch(() => {});
        throw cleanupError;
      }
    } catch (error) {
      this.fastify.log.error(error, 'Failed to generate video thumbnail with fluent-ffmpeg:');

      // Try alternative: simple frame extraction using node-ffmpeg if fluent-ffmpeg fails
      try {
        return await this.generateVideoThumbnailAlternative(videoBuffer, {
          width,
          height,
          timeOffset,
        });
      } catch (altError) {
        this.fastify.log.error('Alternative video thumbnail generation also failed:', altError);

        // Final fallback: generate a video-themed placeholder
        return await this.generateVideoPlaceholderThumbnail(width, height);
      }
    }
  }

  private async generateVideoThumbnailAlternative(
    videoBuffer: Buffer,
    options: { width?: number; height?: number; timeOffset?: number }
  ): Promise<Buffer> {
    // Alternative implementation using child_process to call system ffmpeg directly
    const { width = 200, height = 200, timeOffset = 1 } = options;

    return new Promise((resolve, reject) => {
      const ffmpegProcess = spawn('ffmpeg', [
        '-i',
        'pipe:0', // Read from stdin
        '-ss',
        timeOffset.toString(),
        '-vframes',
        '1',
        '-vf',
        `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        'pipe:1', // Output to stdout
      ]);

      let thumbnailBuffer = Buffer.alloc(0);
      let errorOutput = '';

      ffmpegProcess.stdin.write(videoBuffer);
      ffmpegProcess.stdin.end();

      ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
        thumbnailBuffer = Buffer.concat([thumbnailBuffer, chunk]);
      });

      ffmpegProcess.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      ffmpegProcess.on('close', (code: number) => {
        if (code === 0 && thumbnailBuffer.length > 0) {
          resolve(thumbnailBuffer);
        } else {
          reject(new Error(`FFmpeg failed with code ${code}: ${errorOutput}`));
        }
      });

      ffmpegProcess.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  private async generateVideoPlaceholderThumbnail(width: number, height: number): Promise<Buffer> {
    // Create a better video placeholder - a play button icon on dark background
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#1a1a1a"/>
        <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 6}" fill="rgba(255,255,255,0.8)"/>
        <polygon points="${width / 2 - 10},${height / 2 - 12} ${width / 2 + 15},${height / 2} ${width / 2 - 10},${height / 2 + 12}" fill="#1a1a1a"/>
      </svg>
    `;

    return await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  }

  private async generatePlaceholderThumbnail(
    width: number,
    height: number,
    type: string = 'video'
  ): Promise<Buffer> {
    // Create a simple colored placeholder using Sharp
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f0f0f0"/>
        <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" 
              font-family="Arial" font-size="14" fill="#666">
          ${type.toUpperCase()}
        </text>
      </svg>
    `;

    return await sharp(Buffer.from(svg)).png().toBuffer();
  }

  private generateKey(organizationId: string, mediaId: string, extension: string): string {
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return `media/${organizationId}/${timestamp}/${mediaId}${extension}`;
  }

  private sanitizeMetadata(value: string): string {
    // AWS S3 metadata must be ASCII and cannot contain certain characters
    // Replace non-ASCII characters and control characters
    return value
      .replace(/[^\x20-\x7E]/g, '') // Remove non-ASCII characters
      .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
      .trim()
      .substring(0, 2048); // AWS metadata value limit
  }

  getPublicUrl(key: string): string {
    if (process.env.S3_PUBLIC_URL) {
      return `${process.env.S3_PUBLIC_URL}/${key}`;
    }

    if (process.env.S3_ENDPOINT) {
      return `${process.env.S3_ENDPOINT}/${this.bucket}/${key}`;
    }

    return `https://${this.bucket}.s3.amazonaws.com/${key}`;
  }

  isImageType(contentType: string): boolean {
    return (
      contentType.startsWith('image/') &&
      ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'].includes(contentType)
    );
  }

  isVideoType(contentType: string): boolean {
    return (
      contentType.startsWith('video/') &&
      ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/webm'].includes(contentType)
    );
  }

  isAudioType(contentType: string): boolean {
    return (
      contentType.startsWith('audio/') &&
      ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/m4a'].includes(contentType)
    );
  }

  isDocumentType(contentType: string): boolean {
    return [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv',
    ].includes(contentType);
  }

  getMediaType(contentType: string): 'image' | 'video' | 'audio' | 'document' | 'unknown' {
    if (this.isImageType(contentType)) return 'image';
    if (this.isVideoType(contentType)) return 'video';
    if (this.isAudioType(contentType)) return 'audio';
    if (this.isDocumentType(contentType)) return 'document';
    return 'unknown';
  }

  validateFileSize(size: number, type: 'image' | 'video' | 'audio' | 'document'): boolean {
    const limits = {
      image: 5 * 1024 * 1024, // 5MB
      video: 50 * 1024 * 1024, // 50MB
      audio: 10 * 1024 * 1024, // 10MB
      document: 20 * 1024 * 1024, // 20MB
    };

    return size <= limits[type];
  }
}
