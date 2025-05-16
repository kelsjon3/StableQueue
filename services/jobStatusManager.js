// Job Status Manager for real-time job status updates
// This service manages WebSocket connections via socket.io to provide real-time job status updates
// to connected clients while maintaining background job processing

const socketIO = require('socket.io');
const jobQueue = require('../utils/jobQueueHelpers');
const { readServersConfig } = require('../utils/configHelpers');

// Store socket.io server instance
let io = null;

// Initialize the socket.io server
function initialize(server) {
  console.log('[JobStatusManager] Initializing socket.io server');
  
  // Create socket.io server
  io = socketIO(server, {
    cors: {
      origin: '*', // Allow all origins for development
      methods: ['GET', 'POST']
    }
  });
  
  // Set up connection handler
  io.on('connection', (socket) => {
    console.log(`[JobStatusManager] New client connected (id: ${socket.id})`);
    
    // Send initial job status to the client
    sendInitialJobStatus(socket);
    
    // Handle client messages (like job ID subscriptions)
    socket.on('subscribe_job', (jobId) => {
      console.log(`[JobStatusManager] Client ${socket.id} subscribed to job ${jobId}`);
      // We could store specific subscriptions here if needed
      socket.join(`job:${jobId}`);
    });
    
    // Handle client disconnect
    socket.on('disconnect', () => {
      console.log(`[JobStatusManager] Client disconnected (id: ${socket.id})`);
    });
  });
  
  console.log('[JobStatusManager] Socket.io server initialized');
  return io;
}

// Send initial job status to a new client
async function sendInitialJobStatus(socket) {
  try {
    // Get all jobs
    const jobs = jobQueue.getAllJobs();
    
    // Send the jobs to the client
    socket.emit('initial_jobs', jobs);
  } catch (err) {
    console.error('[JobStatusManager] Error sending initial job status:', err);
  }
}

// Broadcast job status update to all connected clients
function broadcastJobUpdate(job) {
  if (!io) return;
  
  console.log(`[JobStatusManager] Broadcasting job update for job ${job.mobilesd_job_id}`);
  
  // Broadcast to all clients
  io.emit('job_update', job);
  
  // Also broadcast to the specific job room
  io.to(`job:${job.mobilesd_job_id}`).emit('job_update', job);
}

// Broadcast job progress update to all connected clients
function broadcastJobProgress(jobId, progressPercentage, previewImage) {
  if (!io) return;
  
  const progressData = {
    jobId: jobId,
    progress_percentage: progressPercentage,
    preview_image: previewImage
  };
  
  console.log(`[JobStatusManager] Broadcasting progress update for job ${jobId}: ${progressPercentage}%`);
  
  // Broadcast to all clients
  io.emit('job_progress', progressData);
  
  // Also broadcast to the specific job room
  io.to(`job:${jobId}`).emit('job_progress', progressData);
}

module.exports = {
  initialize,
  broadcastJobUpdate,
  broadcastJobProgress
}; 