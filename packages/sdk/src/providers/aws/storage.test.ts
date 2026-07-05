import { describe, it, expect, vi } from 'vitest'

// vi.hoisted: vi.mock is hoisted above normal consts, so `send` and `getSignedUrl`
// must be too — same pattern as secret.test.ts.
const { send, getSignedUrl } = vi.hoisted(() => ({
  send: vi.fn(),
  getSignedUrl: vi.fn(),
}))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send })),
  PutObjectCommand: vi.fn((i) => i),
  GetObjectCommand: vi.fn((i) => i),
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }))

import { makeStorage } from './storage.js'

describe('makeStorage', () => {
  it('getSignedUrl calls presigner with GET command + default 15min expiry', async () => {
    getSignedUrl.mockResolvedValue('https://signed/get')

    const s = makeStorage('bucket-a')
    const url = await s.getSignedUrl('file.png')

    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      { Bucket: 'bucket-a', Key: 'file.png' },
      { expiresIn: 900 },
    )
    expect(url).toBe('https://signed/get')
  })

  it('putSignedUrl passes contentType through and honors expiresIn', async () => {
    getSignedUrl.mockReset()
    getSignedUrl.mockResolvedValue('https://signed/put')

    const s = makeStorage('bucket-a')
    const url = await s.putSignedUrl('avatars/1.jpg', { expiresIn: 60, contentType: 'image/jpeg' })

    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      { Bucket: 'bucket-a', Key: 'avatars/1.jpg', ContentType: 'image/jpeg' },
      { expiresIn: 60 },
    )
    expect(url).toBe('https://signed/put')
  })
})