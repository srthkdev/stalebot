'use client'

import React, { useState } from 'react'
import { useQuery } from 'convex/react'
import { useAuthActions } from '@convex-dev/auth/react'
import { api } from '../../../convex/_generated/api'
import { LoadingSpinner } from '../ui/LoadingSpinner'

export function UserProfileForm() {
  const currentUser = useQuery(api.auth.getCurrentUser)
  const { signOut } = useAuthActions()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleSignOut = async () => {
    try {
      setIsSigningOut(true)
      await signOut()
    } catch (error) {
      console.error('Sign out failed:', error)
    } finally {
      setIsSigningOut(false)
    }
  }

  if (currentUser === undefined) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner />
        </div>
      </div>
    )
  }

  if (!currentUser) {
    return (
      <div className="card">
        <div className="text-center py-8">
          <p className="text-gray-600">Unable to load user profile</p>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Account Information</h2>
        <p className="text-gray-600">Your GitHub account details</p>
      </div>

      <div className="space-y-6">
        <div className="flex items-center space-x-4">
          {currentUser.avatarUrl && (
            <img
              src={currentUser.avatarUrl}
              alt={currentUser.name || 'User avatar'}
              className="h-16 w-16 rounded-full"
            />
          )}
          <div>
            <h3 className="text-lg font-medium text-gray-900">
              {currentUser.name || 'GitHub User'}
            </h3>
            <p className="text-gray-600">@{currentUser.githubId}</p>
            <p className="text-sm text-gray-500">{currentUser.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              GitHub Username
            </label>
            <input
              type="text"
              value={currentUser.githubId || ''}
              disabled
              className="input bg-gray-50 text-gray-500 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email Address
            </label>
            <input
              type="email"
              value={currentUser.email || ''}
              disabled
              className="input bg-gray-50 text-gray-500 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Display Name
            </label>
            <input
              type="text"
              value={currentUser.name || ''}
              disabled
              className="input bg-gray-50 text-gray-500 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Member Since
            </label>
            <input
              type="text"
              value={new Date(currentUser.createdAt).toLocaleDateString()}
              disabled
              className="input bg-gray-50 text-gray-500 cursor-not-allowed"
            />
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start">
            <svg className="h-5 w-5 text-blue-600 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h4 className="font-medium text-blue-900 mb-1">Account Information</h4>
              <p className="text-sm text-blue-800">
                Your account information is synced from GitHub and cannot be edited here. 
                To update your profile, please make changes on GitHub.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-gray-900">Account Actions</h3>
              <p className="text-sm text-gray-600">Manage your StaleBot account</p>
            </div>
            <button
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="btn-secondary text-red-600 hover:text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {isSigningOut ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Signing out...
                </>
              ) : (
                'Sign Out'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}