'use client'

import React, { useEffect, useState } from 'react'
import { useConvexAuth } from 'convex/react'
import { useRouter } from 'next/navigation'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { RepositorySelector } from '../components/onboarding/RepositorySelector'
import { OnboardingWelcome } from '../components/onboarding/OnboardingWelcome'
import { OnboardingComplete } from '../components/onboarding/OnboardingComplete'

type OnboardingStep = 'welcome' | 'repositories' | 'complete'

export default function OnboardingPage() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome')
  const [selectedRepositories, setSelectedRepositories] = useState<any[]>([])

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

  const handleStepComplete = (step: OnboardingStep, data?: any) => {
    switch (step) {
      case 'welcome':
        setCurrentStep('repositories')
        break
      case 'repositories':
        setSelectedRepositories(data.repositories)
        setCurrentStep('complete')
        break
      case 'complete':
        router.push('/dashboard')
        break
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8">
        {/* Progress indicator */}
        <div className="max-w-2xl mx-auto mb-8">
          <div className="flex items-center justify-center space-x-4">
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
              currentStep === 'welcome' ? 'bg-primary-600 text-white' : 'bg-primary-100 text-primary-600'
            }`}>
              1
            </div>
            <div className={`h-1 w-16 ${
              ['repositories', 'complete'].includes(currentStep) ? 'bg-primary-600' : 'bg-gray-300'
            }`} />
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
              currentStep === 'repositories' ? 'bg-primary-600 text-white' : 
              currentStep === 'complete' ? 'bg-primary-100 text-primary-600' : 'bg-gray-300 text-gray-500'
            }`}>
              2
            </div>
            <div className={`h-1 w-16 ${
              currentStep === 'complete' ? 'bg-primary-600' : 'bg-gray-300'
            }`} />
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
              currentStep === 'complete' ? 'bg-primary-600 text-white' : 'bg-gray-300 text-gray-500'
            }`}>
              3
            </div>
          </div>
        </div>

        {/* Step content */}
        <div className="max-w-4xl mx-auto">
          {currentStep === 'welcome' && (
            <OnboardingWelcome onComplete={() => handleStepComplete('welcome')} />
          )}
          
          {currentStep === 'repositories' && (
            <RepositorySelector onComplete={(data) => handleStepComplete('repositories', data)} />
          )}
          
          {currentStep === 'complete' && (
            <OnboardingComplete 
              selectedRepositories={selectedRepositories}
              onComplete={() => handleStepComplete('complete')} 
            />
          )}
        </div>
      </div>
    </div>
  )
}