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
    this.bucket = process.env.S3_BUCKET || 'whatsapp-media';
    
    this.s3Client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || '',
        secretAccessKey: process.env.S3_SECRET_KEY || '',
      },
      forcePathStyle: !!process.env.S3_ENDPOINT, // Required for MinIO and localstack
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
        originalName: options.filename,
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

  async uploadBuffer(
    buffer: Buffer,
    options: UploadOptions & { key?: string }
  ): Promise<{ key: string; url: string }> {
    const extension = path.extname(options.filename) || mime.extension(options.contentType) || '';
    const key = options.key || this.generateKey(options.organizationId, createId(), extension.toString());

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: options.contentType,
      Metadata: {
        organizationId: options.organizationId,
        originalName: options.filename,
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
    const key = options.key || this.generateKey(options.organizationId, createId(), extension.toString());

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: stream,
      ContentType: options.contentType,
      Metadata: {
        organizationId: options.organizationId,
        originalName: options.filename,
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

  async processImage(buffer: Buffer): Promise<{
    processedBuffer: Buffer;
    metadata: { width: number; height: number; format: string };
  }> {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    // Optimize image
    let processedBuffer: Buffer;
    
    if (metadata.format === 'jpeg' || metadata.format === 'jpg') {
      processedBuffer = await image.jpeg({ quality: 85 }).toBuffer();
    } else if (metadata.format === 'png') {
      processedBuffer = await image.png({ quality: 85 }).toBuffer();
    } else if (metadata.format === 'webp') {
      processedBuffer = await image.webp({ quality: 85 }).toBuffer();
    } else {
      // Convert unsupported formats to JPEG
      processedBuffer = await image.jpeg({ quality: 85 }).toBuffer();
    }

    return {
      processedBuffer,
      metadata: {
        width: metadata.width || 0,
        height: metadata.height || 0,
        format: metadata.format || 'jpeg',
      },
    };
  }

  private generateKey(organizationId: string, mediaId: string, extension: string): string {
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return `media/${organizationId}/${timestamp}/${mediaId}${extension}`;
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
    return contentType.startsWith('image/') && 
           ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'].includes(contentType);
  }

  isVideoType(contentType: string): boolean {
    return contentType.startsWith('video/') &&
           ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/webm'].includes(contentType);
  }

  isAudioType(contentType: string): boolean {
    return contentType.startsWith('audio/') &&
           ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/m4a'].includes(contentType);
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
      image: 5 * 1024 * 1024,    // 5MB
      video: 50 * 1024 * 1024,   // 50MB
      audio: 10 * 1024 * 1024,   // 10MB
      document: 20 * 1024 * 1024, // 20MB
    };

    return size <= limits[type];
  }
}