// This file is no longer needed - TUS service removed
// Direct R2 uploads are now handled via presigned URLs and direct upload endpoints
export class TusService {
  constructor() {
    throw new Error('TUS service has been removed - use direct R2 uploads instead');
  }
}