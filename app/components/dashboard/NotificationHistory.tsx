'use client'

import React, { useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { LoadingSpinner } from '../ui/LoadingSpinner'

export function NotificationHistory() {
    // For now, return empty array until API is generated
    const notifications = useQuery(api.userNotifications.getUserNotificationHistory, { limit: 20 })
    const [selectedNotification, setSelectedNotification] = useState<string | null>(null)

    if (notifications === undefined) {
        return (
            <div className="card">
                <div className="flex items-center justify-center py-8">
                    <LoadingSpinner />
                </div>
            </div>
        )
    }

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleString()
    }

    const getStatusBadge = (status: string) => {
        const statusConfig = {
            pending: { color: 'bg-yellow-100 text-yellow-800', label: 'Pending' },
            sent: { color: 'bg-blue-100 text-blue-800', label: 'Sent' },
            delivered: { color: 'bg-green-100 text-green-800', label: 'Delivered' },
            bounced: { color: 'bg-red-100 text-red-800', label: 'Bounced' },
            failed: { color: 'bg-red-100 text-red-800', label: 'Failed' },
        }

        const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending
        return (
            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
                {config.label}
            </span>
        )
    }

    return (
        <div className="card">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Recent Notifications</h2>
                <div className="text-sm text-gray-600">
                    Last 20 notifications
                </div>
            </div>

            {notifications.length === 0 ? (
                <div className="text-center py-12">
                    <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No notifications yet</h3>
                    <p className="text-gray-600">
                        Notifications will appear here when stale issues are detected and emails are sent.
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {notifications.map((notification) => (
                        <div key={notification._id} className="border border-gray-200 rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center space-x-3">
                                        <h4 className="font-medium text-gray-900">
                                            {notification.repositoryName || 'Unknown Repository'}
                                        </h4>
                                        {getStatusBadge(notification.status)}
                                    </div>

                                    <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600">
                                        <div>
                                            <span className="font-medium">Sent:</span>{' '}
                                            {formatDate(notification.sentAt)}
                                        </div>
                                        <div>
                                            <span className="font-medium">Issues:</span>{' '}
                                            {notification.issueCount || 0}
                                        </div>
                                        <div>
                                            <span className="font-medium">Email ID:</span>{' '}
                                            <code className="text-xs bg-gray-100 px-1 rounded">
                                                {notification.emailId?.substring(0, 8)}...
                                            </code>
                                        </div>
                                    </div>

                                    {notification.deliveredAt && (
                                        <div className="mt-1 text-sm text-gray-600">
                                            <span className="font-medium">Delivered:</span>{' '}
                                            {formatDate(notification.deliveredAt)}
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={() => setSelectedNotification(
                                        selectedNotification === notification._id ? null : notification._id
                                    )}
                                    className="btn-secondary text-sm"
                                >
                                    {selectedNotification === notification._id ? 'Hide Details' : 'View Details'}
                                </button>
                            </div>

                            {/* Expanded details */}
                            {selectedNotification === notification._id && (
                                <div className="mt-4 pt-4 border-t border-gray-200">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <h5 className="font-medium text-gray-900 mb-2">Notification Details</h5>
                                            <div className="space-y-1 text-gray-600">
                                                <div>
                                                    <span className="font-medium">Repository:</span>{' '}
                                                    {notification.repositoryName}
                                                </div>
                                                <div>
                                                    <span className="font-medium">Status:</span>{' '}
                                                    {notification.status}
                                                </div>
                                                <div>
                                                    <span className="font-medium">Email ID:</span>{' '}
                                                    <code className="text-xs bg-gray-100 px-1 rounded">
                                                        {notification.emailId}
                                                    </code>
                                                </div>
                                                {notification.deliveredAt && (
                                                    <div>
                                                        <span className="font-medium">Delivery Time:</span>{' '}
                                                        {Math.round((notification.deliveredAt - notification.sentAt) / 1000)}s
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <h5 className="font-medium text-gray-900 mb-2">Issues Included</h5>
                                            <div className="text-gray-600">
                                                {notification.issueCount ? (
                                                    <div>
                                                        {notification.issueCount} stale issue{notification.issueCount !== 1 ? 's' : ''} detected
                                                    </div>
                                                ) : (
                                                    <div>No issue details available</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Status timeline */}
                                    <div className="mt-4">
                                        <h5 className="font-medium text-gray-900 mb-2">Status Timeline</h5>
                                        <div className="flex items-center space-x-4 text-sm">
                                            <div className="flex items-center">
                                                <div className="h-2 w-2 bg-blue-500 rounded-full mr-2"></div>
                                                <span className="text-gray-600">
                                                    Sent: {formatDate(notification.sentAt)}
                                                </span>
                                            </div>

                                            {notification.deliveredAt && (
                                                <div className="flex items-center">
                                                    <div className="h-2 w-2 bg-green-500 rounded-full mr-2"></div>
                                                    <span className="text-gray-600">
                                                        Delivered: {formatDate(notification.deliveredAt)}
                                                    </span>
                                                </div>
                                            )}

                                            {notification.status === 'bounced' && (
                                                <div className="flex items-center">
                                                    <div className="h-2 w-2 bg-red-500 rounded-full mr-2"></div>
                                                    <span className="text-gray-600">Bounced</span>
                                                </div>
                                            )}

                                            {notification.status === 'failed' && (
                                                <div className="flex items-center">
                                                    <div className="h-2 w-2 bg-red-500 rounded-full mr-2"></div>
                                                    <span className="text-gray-600">Failed</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}

                    {/* Load more button (placeholder) */}
                    <div className="text-center pt-4">
                        <button className="btn-secondary">
                            Load More Notifications
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}