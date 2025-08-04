'use client'

import React, { useEffect } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { useConvexAuth } from 'convex/react'
import { useRouter } from 'next/navigation'
import { GitHubIcon } from './components/icons/GitHubIcon'
import { LoadingSpinner } from './components/ui/LoadingSpinner'

export default function HomePage() {
  const { signIn } = useAuthActions()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const router = useRouter()

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/onboarding')
    }
  }, [isAuthenticated, router])

  const handleGitHubSignIn = () => {
    void signIn('github')
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  if (isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner />
        <p className="ml-3 text-gray-600">Redirecting...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="mx-auto h-16 w-16 bg-primary-600 rounded-full flex items-center justify-center mb-4">
            <GitHubIcon className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome to StaleBot
          </h1>
          <p className="text-gray-600">
            Your GitHub Issue Janitor - Monitor repositories for stale issues and get email notifications
          </p>
        </div>

        <div className="card">
          <div className="space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Get Started
              </h2>
              <p className="text-gray-600 text-sm mb-6">
                Sign in with your GitHub account to start monitoring your repositories
              </p>
            </div>

            <button
              onClick={handleGitHubSignIn}
              className="w-full flex items-center justify-center px-4 py-3 border border-transparent rounded-lg shadow-sm bg-gray-900 hover:bg-gray-800 text-white font-medium transition-colors duration-200"
            >
              <GitHubIcon className="h-5 w-5 mr-3" />
              Sign in with GitHub
            </button>

            <div className="text-xs text-gray-500 text-center">
              By signing in, you agree to let StaleBot access your GitHub repositories
              to monitor for stale issues.
            </div>
          </div>
        </div>

        <div className="mt-8 text-center">
          <div className="grid grid-cols-3 gap-4 text-sm text-gray-600">
            <div>
              <div className="font-medium">Monitor</div>
              <div className="text-xs">Track stale issues</div>
            </div>
            <div>
              <div className="font-medium">Notify</div>
              <div className="text-xs">Email alerts</div>
            </div>
            <div>
              <div className="font-medium">Manage</div>
              <div className="text-xs">Custom rules</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}