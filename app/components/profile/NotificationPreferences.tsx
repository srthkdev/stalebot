'use client'

import React, { useState, useEffect } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { LoadingSpinner } from '../ui/LoadingSpinner'

type EmailFrequency = 'immediate' | 'daily' | 'weekly'

interface NotificationPrefs {
  emailFrequency: EmailFrequency
  quietHours: {
    start: number
    end: number
  }
  emailTemplate: string
  pauseNotifications: boolean
}

export function NotificationPreferences() {
  const currentUser = useQuery(api.auth.getCurrentUser)
  const updateProfile = useMutation(api.auth.updateUserProfile)
  
  const [preferences, setPreferences] = useState<NotificationPrefs>({
    emailFrequency: 'immediate',
    quietHours: { start: 22, end: 8 },
    emailTemplate: 'default',
    pauseNotifications: false,
  })
  
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  // Initialize preferences from user data
  useEffect(() => {
    if (currentUser?.notificationPreferences) {
      setPreferences(currentUser.notificationPreferences)
    }
  }, [currentUser])

  const handleSave = async () => {
    try {
      setIsSaving(true)
      setSaveMessage(null)
      
      await updateProfile({
        notificationPreferences: preferences,
      })
      
      setSaveMessage('Preferences saved successfully!')
      setTimeout(() => setSaveMessage(null), 3000)
    } catch (error) {
      console.error('Failed to save preferences:', error)
      setSaveMessage('Failed to save preferences. Please try again.')
      setTimeout(() => setSaveMessage(null), 5000)
    } finally {
      setIsSaving(false)
    }
  }

  const handleFrequencyChange = (frequency: EmailFrequency) => {
    setPreferences(prev => ({ ...prev, emailFrequency: frequency }))
  }

  const handleQuietHoursChange = (field: 'start' | 'end', value: number) => {
    setPreferences(prev => ({
      ...prev,
      quietHours: { ...prev.quietHours, [field]: value }
    }))
  }

  const handlePauseToggle = () => {
    setPreferences(prev => ({ ...prev, pauseNotifications: !prev.pauseNotifications }))
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

  return (
    <div className="card">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Notification Preferences</h2>
        <p className="text-gray-600">Configure how and when you receive stale issue notifications</p>
      </div>

      <div className="space-y-8">
        {/* Email Frequency */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Email Frequency</h3>
          <div className="space-y-3">
            {[
              { value: 'immediate' as const, label: 'Immediate', description: 'Send emails as soon as stale issues are detected' },
              { value: 'daily' as const, label: 'Daily Digest', description: 'Send a daily summary of all stale issues' },
              { value: 'weekly' as const, label: 'Weekly Digest', description: 'Send a weekly summary of all stale issues' },
            ].map((option) => (
              <label key={option.value} className="flex items-start cursor-pointer">
                <input
                  type="radio"
                  name="emailFrequency"
                  value={option.value}
                  checked={preferences.emailFrequency === option.value}
                  onChange={() => handleFrequencyChange(option.value)}
                  className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                />
                <div className="ml-3">
                  <div className="font-medium text-gray-900">{option.label}</div>
                  <div className="text-sm text-gray-600">{option.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Quiet Hours */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Quiet Hours</h3>
          <p className="text-sm text-gray-600 mb-4">
            Set hours when you don't want to receive immediate notifications (24-hour format)
          </p>
          <div className="flex items-center space-x-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start</label>
              <select
                value={preferences.quietHours.start}
                onChange={(e) => handleQuietHoursChange('start', parseInt(e.target.value))}
                className="input w-20"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {i.toString().padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </div>
            <div className="text-gray-500 mt-6">to</div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End</label>
              <select
                value={preferences.quietHours.end}
                onChange={(e) => handleQuietHoursChange('end', parseInt(e.target.value))}
                className="input w-20"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {i.toString().padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Email Template */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Email Template</h3>
          <select
            value={preferences.emailTemplate}
            onChange={(e) => setPreferences(prev => ({ ...prev, emailTemplate: e.target.value }))}
            className="input max-w-xs"
          >
            <option value="default">Default Template</option>
            <option value="minimal">Minimal Template</option>
            <option value="detailed">Detailed Template</option>
          </select>
          <p className="text-sm text-gray-600 mt-2">
            Choose the format for your notification emails
          </p>
        </div>

        {/* Pause Notifications */}
        <div>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-gray-900">Pause All Notifications</h3>
              <p className="text-sm text-gray-600">
                Temporarily disable all email notifications
              </p>
            </div>
            <button
              type="button"
              onClick={handlePauseToggle}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                preferences.pauseNotifications ? 'bg-primary-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  preferences.pauseNotifications ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          
          {preferences.pauseNotifications && (
            <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <div className="flex items-start">
                <svg className="h-5 w-5 text-yellow-600 mt-0.5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <p className="text-sm text-yellow-800">
                  Notifications are currently paused. You won't receive any email alerts until you re-enable them.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Save Button */}
        <div className="pt-6 border-t border-gray-200">
          <div className="flex items-center justify-between">
            {saveMessage && (
              <div className={`text-sm ${
                saveMessage.includes('success') ? 'text-green-600' : 'text-red-600'
              }`}>
                {saveMessage}
              </div>
            )}
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
            >
              {isSaving ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Saving...
                </>
              ) : (
                'Save Preferences'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}