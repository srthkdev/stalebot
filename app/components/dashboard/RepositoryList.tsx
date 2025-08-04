'use client'

import React, { useState } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { RuleManagement } from './RuleManagement'

export function RepositoryList() {
  const repositories = useQuery(api.repositories.getUserRepositories)
  const healthStatuses = useQuery(api.repositories.getAllRepositoriesHealthStatus)
  const manualRefresh = useMutation(api.repositories.manualRefreshRepository)

  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [refreshingRepos, setRefreshingRepos] = useState<Set<string>>(new Set())

  if (repositories === undefined || healthStatuses === undefined) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner />
        </div>
      </div>
    )
  }

  const handleManualRefresh = async (repositoryId: string) => {
    try {
      setRefreshingRepos(prev => new Set(prev).add(repositoryId))
      await manualRefresh({ repositoryId: repositoryId as any })
    } catch (error) {
      console.error('Manual refresh failed:', error)
    } finally {
      setRefreshingRepos(prev => {
        const newSet = new Set(prev)
        newSet.delete(repositoryId)
        return newSet
      })
    }
  }

  const formatTimeAgo = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / (1000 * 60))
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    if (minutes > 0) return `${minutes}m ago`
    return 'Just now'
  }

  const getHealthBadge = (healthScore: number) => {
    if (healthScore >= 80) {
      return { color: 'bg-green-100 text-green-800', label: 'Healthy' }
    } else if (healthScore >= 60) {
      return { color: 'bg-yellow-100 text-yellow-800', label: 'Warning' }
    } else {
      return { color: 'bg-red-100 text-red-800', label: 'Critical' }
    }
  }

  if (repositories.length === 0) {
    return (
      <div className="card">
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No repositories yet</h3>
          <p className="text-gray-600 mb-4">
            Add repositories to start monitoring for stale issues.
          </p>
          <button className="btn-primary">
            Add Your First Repository
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Repository Monitoring</h2>
          <button className="btn-primary">
            Add Repository
          </button>
        </div>

        <div className="space-y-4">
          {repositories.map((repo) => {
            const healthStatus = healthStatuses.find(h => h.repositoryId === repo._id)
            const healthBadge = healthStatus ? getHealthBadge(healthStatus.healthScore) : null

            return (
              <div key={repo._id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3">
                      <h3 className="font-medium text-gray-900">{repo.name}</h3>
                      <span className="text-sm text-gray-600">{repo.fullName}</span>

                      {healthBadge && (
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${healthBadge.color}`}>
                          {healthBadge.label}
                        </span>
                      )}

                      {!repo.isActive && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          Inactive
                        </span>
                      )}
                    </div>

                    <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-600">
                      <div>
                        <span className="font-medium">Last Check:</span>{' '}
                        {repo.lastChecked ? formatTimeAgo(repo.lastChecked) : 'Never'}
                      </div>
                      <div>
                        <span className="font-medium">Issues:</span>{' '}
                        {healthStatus?.statistics.totalIssues || 0}
                      </div>
                      <div>
                        <span className="font-medium">Stale:</span>{' '}
                        {healthStatus?.statistics.staleIssues || 0}
                      </div>
                      <div>
                        <span className="font-medium">Health:</span>{' '}
                        {healthStatus?.healthScore || 0}%
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleManualRefresh(repo._id)}
                      disabled={refreshingRepos.has(repo._id)}
                      className="btn-secondary text-sm disabled:opacity-50"
                    >
                      {refreshingRepos.has(repo._id) ? (
                        <>
                          <LoadingSpinner size="sm" className="mr-1" />
                          Refreshing...
                        </>
                      ) : (
                        'Refresh'
                      )}
                    </button>

                    <button
                      onClick={() => setSelectedRepo(selectedRepo === repo._id ? null : repo._id)}
                      className="btn-secondary text-sm"
                    >
                      {selectedRepo === repo._id ? 'Hide Rules' : 'Manage Rules'}
                    </button>
                  </div>
                </div>

                {/* Expanded rule management */}
                {selectedRepo === repo._id && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <RuleManagement repositoryId={repo._id} repositoryName={repo.fullName} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}