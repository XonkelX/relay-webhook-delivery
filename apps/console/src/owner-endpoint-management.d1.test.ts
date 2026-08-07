import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { updateOwnerEndpointStatus } from '../worker/lib/owner-endpoint-management.js'

const createdAt = '2026-08-07T16:00:00.000Z'

describe('owner endpoint status management', () => {
  it('pauses and resumes only previously verified endpoints', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO endpoints (
           id,
           name,
           url,
           status,
           created_at,
           updated_at,
           verified_at
         )
         VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      ).bind(
        'ep_ownerstatusactive',
        'Status active',
        'https://active.example.test/webhook',
        createdAt,
        createdAt,
        createdAt,
      ),

      env.DB.prepare(
        `INSERT INTO endpoints (
           id,
           name,
           url,
           status,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, 'pending', ?, ?)`,
      ).bind(
        'ep_ownerstatuspending',
        'Status pending',
        'https://pending.example.test/webhook',
        createdAt,
        createdAt,
      ),
    ])

    await expect(
      updateOwnerEndpointStatus(env.DB, 'ep_ownerstatusactive', 'paused', {
        now: () => '2026-08-07T16:01:00.000Z',
        createId: () => 'aud_ownerstatuspause',
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        endpointId: 'ep_ownerstatusactive',
        status: 'paused',
        updatedAt: '2026-08-07T16:01:00.000Z',
        changed: true,
      },
    })

    await expect(
      updateOwnerEndpointStatus(env.DB, 'ep_ownerstatusactive', 'paused'),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        endpointId: 'ep_ownerstatusactive',
        status: 'paused',
        changed: false,
      },
    })

    await expect(
      updateOwnerEndpointStatus(env.DB, 'ep_ownerstatusactive', 'active', {
        now: () => '2026-08-07T16:02:00.000Z',
        createId: () => 'aud_ownerstatusresume',
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        endpointId: 'ep_ownerstatusactive',
        status: 'active',
        updatedAt: '2026-08-07T16:02:00.000Z',
        changed: true,
      },
    })

    await expect(
      updateOwnerEndpointStatus(env.DB, 'ep_ownerstatuspending', 'active'),
    ).resolves.toEqual({
      ok: false,
      reason: 'ineligible',
      status: 'pending',
    })

    const audit = await env.DB.prepare(
      `SELECT action
         FROM audit_log
         WHERE target_id = 'ep_ownerstatusactive'
         ORDER BY created_at`,
    ).all<{ action: string }>()

    expect(audit.results.map((row) => row.action)).toEqual(['endpoint.paused', 'endpoint.resumed'])
  })
})
