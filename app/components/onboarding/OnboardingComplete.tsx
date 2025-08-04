'use client'

import React from 'react'

interface Repository {
  githubId: number
  name: string
  fullName: string
  private: boolean
}

interface OnboardingCompleteProps {
  selectedRepositories: Repository[]
  onComplete: () => void
}

export function OnboardingComplete({ selectedRepositories, onComplete }: OnboardingCompleteProps) {
  return (
    <div className="text-center">
      <div className="card max-w-2xl mx-auto">
        <div className="mb-6">
          <div className="mx-auto h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <svg className="h-8 w-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            You're all set!
          </h1>
          <p className="text-gray-600">
            StaleBot is now configured and ready to monitor your repositories.
          </p>
        </div>

        {selectedRepositories.length > 0 ? (
          <div className="mb-8">
            <h3 className="font-medium text-gray-900 mb-4">
              Monitoring {selectedRepositories.length} repositories:
            </h3>
            <div className="bg-gray-50 rounded-lg p-4 max-h-48 overflow-y-auto">
              <div className="space-y-2">
                {selectedRepositories.map((repo) => (
                  <div key={repo.githubId} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-900">{repo.name}</span>
                    <span className="text-gray-600">{repo.fullName}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-8">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start">
                <svg className="h-5 w-5 text-blue-600 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <h4 className="font-medium text-blue-900 mb-1">No repositories selected</h4>
                  <p className="text-sm text-blue-800">
                    You can add repositories to monitor anytime from your dashboard.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-6 mb-8">
          <div className="text-left">
            <h3 className="font-medium text-gray-900 mb-4">What happens next?</h3>
            <div className="space-y-3">
              <div className="flex items-start">
                <div className="flex-shrink-0 w-6 h-6 bg-primary-100 rounded-full flex items-center justify-center mr-3 mt-0.5">
                  <span className="text-xs font-medium text-primary-600">1</span>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900">Set up stale detection rules</h4>
                  <p className="text-sm text-gray-600">Define what makes an issue stale in your repositories</p>
                </div>
              </div>
              
              <div className="flex items-start">
                <div className="flex-shrink-0 w-6 h-6 bg-primary-100 rounded-full flex items-center justify-center mr-3 mt-0.5">
                  <span className="text-xs font-medium text-primary-600">2</span>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900">Configure notification preferences</h4>
                  <p className="text-sm text-gray-600">Choose how and when you want to receive alerts</p>
                </div>
              </div>
              
              <div className="flex items-start">
                <div className="flex-shrink-0 w-6 h-6 bg-primary-100 rounded-full flex items-center justify-center mr-3 mt-0.5">
                  <span className="text-xs font-medium text-primary-600">3</span>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900">Start monitoring</h4>
                  <p className="text-sm text-gray-600">StaleBot will automatically check for stale issues and notify you</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={onComplete}
          className="w-full btn-primary text-lg py-3"
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  )
}