'use client'

import React from 'react'
import { useConvexAuth } from 'convex/react'
import { useQuery } from 'convex/react'
import { useAuthActions } from '@convex-dev/auth/react'
import { api } from '../../../convex/_generated/api'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { GitHubIcon } from '../icons/GitHubIcon'

export function Navigation() {
  const { isAuthenticated } = useConvexAuth()
  const currentUser = useQuery(api.auth.getCurrentUser)
  const { signOut } = useAuthActions()
  const pathname = usePathname()

  if (!isAuthenticated) {
    return null
  }

  const navigation = [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Profile', href: '/profile' },
  ]

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center space-x-2">
            <div className="h-8 w-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <GitHubIcon className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">StaleBot</span>
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center space-x-8">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className={`text-sm font-medium transition-colors duration-200 ${
                  pathname === item.href
                    ? 'text-primary-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {item.name}
              </Link>
            ))}
          </div>

          {/* User Menu */}
          <div className="flex items-center space-x-4">
            {currentUser && (
              <div className="flex items-center space-x-3">
                {currentUser.avatarUrl && (
                  <img
                    src={currentUser.avatarUrl}
                    alt={currentUser.name || 'User'}
                    className="h-8 w-8 rounded-full"
                  />
                )}
                <span className="text-sm font-medium text-gray-900 hidden sm:block">
                  {currentUser.name || currentUser.githubId}
                </span>
              </div>
            )}
            
            <button
              onClick={() => signOut()}
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors duration-200"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}