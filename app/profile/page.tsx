'use client'

import React, { useEffect } from 'react'
import { useConvexAuth } from 'convex/react'
import { useRouter } from 'next/navigation'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { UserProfileForm } from '../components/profile/UserProfileForm'
import { NotificationPreferences } from '../components/profile/NotificationPreferences'

export default function ProfilePage() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/')
    }
  }, [isAuthenticated, isLoading, router])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner />
        <p className="ml-3 text-gray-600">Redirecting...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Profile Settings</h1>
            <p className="text-gray-600">
              Manage your account settings and notification preferences.
            </p>
          </div>

          <div className="space-y-8">
            <UserProfileForm />
            <NotificationPreferences />
          </div>
        </div>
      </div>
    </div>
  )
}