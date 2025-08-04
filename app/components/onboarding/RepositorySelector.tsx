'use client'

import React, { useState, useEffect } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { LoadingSpinner } from '../ui/LoadingSpinner'

interface Repository {
  githubId: number
  name: string
  fullName: string
  private: boolean
  permissions: {
    admin: boolean
    push: boolean
    pull: boolean
  }
}

interface RepositorySelectorProps {
  onComplete: (data: { repositories: Repository[] }) => void
}

export function RepositorySelector({ onComplete }: RepositorySelectorProps) {
  const [selectedRepos, setSelectedRepos] = useState<Set<number>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const getAvailableRepos = useMutation(api.repositories.getAvailableGitHubRepositories)
  const addReposToMonitoring = useMutation(api.repositories.addRepositoriesToMonitoring)
  
  const [availableRepos, setAvailableRepos] = useState<Repository[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Fetch available repositories on component mount
  useEffect(() => {
    const fetchRepos = async () => {
      try {
        setIsLoading(true)
        setFetchError(null)
        const repos = await getAvailableRepos()
        setAvailableRepos(repos)
      } catch (error) {
        console.error('Failed to fetch repositories:', error)
        setFetchError(error instanceof Error ? error.message : 'Failed to fetch repositories')
      } finally {
        setIsLoading(false)
      }
    }

    fetchRepos()
  }, [getAvailableRepos])

  const filteredRepos = availableRepos.filter(repo =>
    repo.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    repo.fullName.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleRepoToggle = (repoId: number) => {
    const newSelected = new Set(selectedRepos)
    if (newSelected.has(repoId)) {
      newSelected.delete(repoId)
    } else {
      newSelected.add(repoId)
    }
    setSelectedRepos(newSelected)
  }

  const handleSelectAll = () => {
    if (selectedRepos.size === filteredRepos.length) {
      setSelectedRepos(new Set())
    } else {
      setSelectedRepos(new Set(filteredRepos.map(repo => repo.githubId)))
    }
  }

  const handleContinue = async () => {
    if (selectedRepos.size === 0) {
      return
    }

    try {
      setIsLoading(true)
      
      const selectedRepositories = availableRepos.filter(repo => 
        selectedRepos.has(repo.githubId)
      )

      // Add repositories to monitoring
      await addReposToMonitoring({
        repositories: selectedRepositories.map(repo => ({
          githubId: repo.githubId,
          name: repo.name,
          fullName: repo.fullName,
        }))
      })

      onComplete({ repositories: selectedRepositories })
    } catch (error) {
      console.error('Failed to add repositories:', error)
      setFetchError(error instanceof Error ? error.message : 'Failed to add repositories')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSkip = () => {
    onComplete({ repositories: [] })
  }

  if (isLoading && availableRepos.length === 0) {
    return (
      <div className="card max-w-4xl mx-auto">
        <div className="text-center py-12">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-gray-600">Loading your repositories...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="card max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Select Repositories to Monitor
        </h2>
        <p className="text-gray-600">
          Choose which repositories you'd like StaleBot to monitor for stale issues. 
          You can add more repositories later from your dashboard.
        </p>
      </div>

      {fetchError && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start">
            <svg className="h-5 w-5 text-red-600 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h4 className="font-medium text-red-900 mb-1">Error loading repositories</h4>
              <p className="text-sm text-red-800">{fetchError}</p>
            </div>
          </div>
        </div>
      )}

      {availableRepos.length > 0 && (
        <>
          {/* Search and controls */}
          <div className="mb-6 space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search repositories..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="input"
                />
              </div>
              <button
                onClick={handleSelectAll}
                className="btn-secondary whitespace-nowrap"
              >
                {selectedRepos.size === filteredRepos.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <div className="text-sm text-gray-600">
              {selectedRepos.size} of {filteredRepos.length} repositories selected
            </div>
          </div>

          {/* Repository list */}
          <div className="mb-6 max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
            {filteredRepos.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No repositories found matching "{searchTerm}"
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {filteredRepos.map((repo) => (
                  <div
                    key={repo.githubId}
                    className="p-4 hover:bg-gray-50 cursor-pointer"
                    onClick={() => handleRepoToggle(repo.githubId)}
                  >
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={selectedRepos.has(repo.githubId)}
                        onChange={() => handleRepoToggle(repo.githubId)}
                        className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                      />
                      <div className="ml-3 flex-1">
                        <div className="flex items-center">
                          <h4 className="font-medium text-gray-900">{repo.name}</h4>
                          {repo.private && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                              Private
                            </span>
                          )}
                          {repo.permissions.admin && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                              Admin
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600">{repo.fullName}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {availableRepos.length === 0 && !fetchError && (
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No repositories available</h3>
          <p className="text-gray-600 mb-4">
            We couldn't find any repositories that you have admin or push access to.
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between">
        <button
          onClick={handleSkip}
          className="btn-secondary"
          disabled={isLoading}
        >
          Skip for now
        </button>
        
        <button
          onClick={handleContinue}
          disabled={selectedRepos.size === 0 || isLoading}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <>
              <LoadingSpinner size="sm" className="mr-2" />
              Adding repositories...
            </>
          ) : (
            `Continue with ${selectedRepos.size} repositories`
          )}
        </button>
      </div>
    </div>
  )
}