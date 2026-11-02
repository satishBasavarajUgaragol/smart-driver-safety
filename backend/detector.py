"""
Fatigue & Drowsiness Computer Vision Detection Module
Computes Eye Aspect Ratio (EAR), Mouth Aspect Ratio (MAR), Head Pose & Safety Metrics.
"""

import math
import time
import numpy as np
from typing import Dict, List, Tuple, Any, Optional

try:
    import cv2
    import mediapipe as mp
    HAS_CV = True
except ImportError:
    HAS_CV = False


# Standard 468/478 MediaPipe Facial Landmark Indices
LEFT_EYE_INDICES = [362, 385, 387, 263, 373, 380]
RIGHT_EYE_INDICES = [33, 160, 158, 133, 153, 144]
# Inner/Outer Lip Indices for Mouth Aspect Ratio
MOUTH_INDICES = [61, 291, 0, 17, 13, 14]  # left corner, right corner, top outer, bottom outer, top inner, bottom inner
# Key points for Head Pose (Nose tip, Chin, Left eye corner, Right eye corner, Left mouth, Right mouth)
POSE_INDICES = [1, 152, 33, 263, 61, 291]


def euclidean_distance(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
    """Calculate Euclidean distance between 2D points"""
    return math.hypot(p1[0] - p2[0], p1[1] - p2[1])


def calculate_ear(landmarks: List[Tuple[float, float]], eye_indices: List[int]) -> float:
    """
    Computes Eye Aspect Ratio (EAR)
    EAR = (|p2 - p6| + |p3 - p5|) / (2 * |p1 - p4|)
    """
    try:
        p1 = landmarks[eye_indices[0]]
        p2 = landmarks[eye_indices[1]]
        p3 = landmarks[eye_indices[2]]
        p4 = landmarks[eye_indices[3]]
        p5 = landmarks[eye_indices[4]]
        p6 = landmarks[eye_indices[5]]

        vert_1 = euclidean_distance(p2, p6)
        vert_2 = euclidean_distance(p3, p5)
        horiz = euclidean_distance(p1, p4)

        if horiz == 0:
            return 0.0
        return (vert_1 + vert_2) / (2.0 * horiz)
    except (IndexError, KeyError):
        return 0.0


def calculate_mar(landmarks: List[Tuple[float, float]], mouth_indices: List[int] = MOUTH_INDICES) -> float:
    """
    Computes Mouth Aspect Ratio (MAR)
    MAR = |top_inner - bottom_inner| / |left_corner - right_corner|
    """
    try:
        left = landmarks[mouth_indices[0]]
        right = landmarks[mouth_indices[1]]
        top = landmarks[mouth_indices[4]]     # inner top (13)
        bottom = landmarks[mouth_indices[5]]  # inner bottom (14)

        vert = euclidean_distance(top, bottom)
        horiz = euclidean_distance(left, right)

        if horiz == 0:
            return 0.0
        return vert / horiz
    except (IndexError, KeyError):
        return 0.0


def estimate_head_pose(landmarks: List[Tuple[float, float]], img_w: int, img_h: int) -> Dict[str, float]:
    """
    Estimate Head Pitch, Yaw, and Roll using 3D-to-2D Perspective-n-Point (PnP)
    """
    # 3D model generic face points
    model_points = np.array([
        (0.0, 0.0, 0.0),             # Nose tip
        (0.0, -330.0, -65.0),        # Chin
        (-225.0, 170.0, -135.0),     # Left eye left corner
        (225.0, 170.0, -135.0),      # Right eye right corner
        (-150.0, -150.0, -125.0),    # Left Mouth corner
        (150.0, -150.0, -125.0)      # Right mouth corner
    ], dtype=np.float64)

    image_points = []
    for idx in POSE_INDICES:
        if idx < len(landmarks):
            pt = landmarks[idx]
            image_points.append([pt[0] * img_w, pt[1] * img_h])
        else:
            return {"pitch": 0.0, "yaw": 0.0, "roll": 0.0, "distracted": False}

    image_points = np.array(image_points, dtype=np.float64)

    focal_length = img_w
    center = (img_w / 2, img_h / 2)
    camera_matrix = np.array([
        [focal_length, 0, center[0]],
        [0, focal_length, center[1]],
        [0, 0, 1]
    ], dtype=np.float64)

    dist_coeffs = np.zeros((4, 1))

    try:
        success, rvec, tvec = cv2.solvePnP(
            model_points, image_points, camera_matrix, dist_coeffs, flags=cv2.SOLVEPNP_ITERATIVE
        )
        if not success:
            return {"pitch": 0.0, "yaw": 0.0, "roll": 0.0, "distracted": False}

        rmat, _ = cv2.Rodrigues(rvec)
        angles, _, _, _, _, _ = cv2.RQDecomp3x3(rmat)

        pitch = angles[0] * 360
        yaw = angles[1] * 360
        roll = angles[2] * 360

        distracted = abs(yaw) > 28 or pitch < -20 or pitch > 25
        return {
            "pitch": round(pitch, 1),
            "yaw": round(yaw, 1),
            "roll": round(roll, 1),
            "distracted": distracted
        }
    except Exception:
        return {"pitch": 0.0, "yaw": 0.0, "roll": 0.0, "distracted": False}


class FatigueDetector:
    """
    High-level tracker for analyzing frame landmarks, detecting drowsiness,
    yawning, distraction, and computing dynamic driver safety scores.
    """
    def __init__(self):
        # Configurable thresholds
        self.ear_threshold = 0.20        # Below this => eyes closed
        self.ear_consec_frames = 10      # ~0.5s closed => Drowsiness / Sleep
        self.mar_threshold = 0.48        # Above this => mouth open wide (yawn)
        self.mar_consec_frames = 8       # ~0.4s open => Confirmed yawn
        self.distraction_frames = 18     # ~1.0s looking away / looking down at phone

        # Internal state counters
        self.drowsy_frame_count = 0
        self.yawn_frame_count = 0
        self.distract_frame_count = 0
        self.total_yawns = 0
        self.total_microsleeps = 0
        self.blink_count = 0
        self.is_blinking = False

        # Sliding window for PERCLOS & Safety Score
        self.ear_history: List[float] = []
        self.mar_history: List[float] = []
        self.history_len = 100
        self.start_time = time.time()

    def update_thresholds(self, config: Dict[str, Any]):
        """Update detection sensitivity settings"""
        if "ear_threshold" in config:
            self.ear_threshold = float(config["ear_threshold"])
        if "ear_consec_frames" in config:
            self.ear_consec_frames = int(config["ear_consec_frames"])
        if "mar_threshold" in config:
            self.mar_threshold = float(config["mar_threshold"])
        if "mar_consec_frames" in config:
            self.mar_consec_frames = int(config["mar_consec_frames"])

    def process_landmarks(self, landmarks: List[Tuple[float, float]], img_w: int = 640, img_h: int = 480) -> Dict[str, Any]:
        """
        Process normalized facial landmarks (list of 468 (x, y) coordinates)
        Returns comprehensive telemetry and alert triggers.
        """
        if not landmarks or len(landmarks) < 468:
            return {
                "face_detected": False,
                "status": "NO_FACE",
                "ear": 0.0,
                "mar": 0.0,
                "safety_score": 50,
                "drowsy_alert": False,
                "yawn_alert": False,
                "distracted_alert": False,
                "total_yawns": self.total_yawns,
                "total_microsleeps": self.total_microsleeps,
            }

        # 1. Compute EAR (Left & Right eye average)
        left_ear = calculate_ear(landmarks, LEFT_EYE_INDICES)
        right_ear = calculate_ear(landmarks, RIGHT_EYE_INDICES)
        avg_ear = round((left_ear + right_ear) / 2.0, 3)

        # 2. Compute MAR (Mouth)
        mar = round(calculate_mar(landmarks, MOUTH_INDICES), 3)

        # 3. Head Pose
        head_pose = estimate_head_pose(landmarks, img_w, img_h) if HAS_CV else {"pitch": 0, "yaw": 0, "roll": 0, "distracted": False}

        # 4. Blink tracking
        if avg_ear < self.ear_threshold:
            if not self.is_blinking:
                self.is_blinking = True
                self.blink_count += 1
            self.drowsy_frame_count += 1
        else:
            self.is_blinking = False
            self.drowsy_frame_count = max(0, self.drowsy_frame_count - 1)

        # 5. Yawn tracking
        if mar > self.mar_threshold:
            self.yawn_frame_count += 1
        else:
            if self.yawn_frame_count >= self.mar_consec_frames:
                self.total_yawns += 1
            self.yawn_frame_count = 0

        # 6. Distraction tracking
        if head_pose.get("distracted", False):
            self.distract_frame_count += 1
        else:
            self.distract_frame_count = max(0, self.distract_frame_count - 1)

        # 7. Alert conditions
        drowsy_alert = self.drowsy_frame_count >= self.ear_consec_frames
        yawn_alert = self.yawn_frame_count >= self.mar_consec_frames
        distracted_alert = self.distract_frame_count >= self.distraction_frames

        if drowsy_alert and self.drowsy_frame_count == self.ear_consec_frames:
            self.total_microsleeps += 1

        # 8. History tracking
        self.ear_history.append(avg_ear)
        self.mar_history.append(mar)
        if len(self.ear_history) > self.history_len:
            self.ear_history.pop(0)
            self.mar_history.pop(0)

        # 9. Dynamic Safety & Alertness Score (100 = Perfect, 0 = Dangerous)
        # Factor eye closure, yawn penalties, distraction penalties
        score = 100
        if avg_ear < self.ear_threshold:
            score -= min(40, (self.drowsy_frame_count / self.ear_consec_frames) * 40)
        if mar > self.mar_threshold:
            score -= min(25, (self.yawn_frame_count / self.mar_consec_frames) * 25)
        if head_pose.get("distracted"):
            score -= 20
        # Cumulative fatigue penalty based on total yawns
        score -= min(25, self.total_yawns * 5 + self.total_microsleeps * 15)
        safety_score = max(5, min(100, int(score)))

        # 10. Overall Status Label
        if drowsy_alert:
            status = "CRITICAL_DROWSINESS"
        elif yawn_alert:
            status = "YAWNING_WARNING"
        elif distracted_alert:
            status = "DISTRACTED"
        elif self.drowsy_frame_count > 5:
            status = "MILD_DROWSY"
        elif self.total_yawns >= 3:
            status = "FATIGUE_ADVISORY"
        else:
            status = "ALERT_NORMAL"

        return {
            "face_detected": True,
            "status": status,
            "ear": avg_ear,
            "mar": mar,
            "head_pose": head_pose,
            "drowsy_frame_count": self.drowsy_frame_count,
            "yawn_frame_count": self.yawn_frame_count,
            "drowsy_alert": drowsy_alert,
            "yawn_alert": yawn_alert,
            "distracted_alert": distracted_alert,
            "safety_score": safety_score,
            "total_yawns": self.total_yawns,
            "total_microsleeps": self.total_microsleeps,
            "blink_count": self.blink_count,
            "ear_threshold": self.ear_threshold,
            "mar_threshold": self.mar_threshold,
        }

    def reset_trip(self):
        """Reset trip counters"""
        self.drowsy_frame_count = 0
        self.yawn_frame_count = 0
        self.distract_frame_count = 0
        self.total_yawns = 0
        self.total_microsleeps = 0
        self.blink_count = 0
        self.ear_history.clear()
        self.mar_history.clear()
        self.start_time = time.time()


# Global Detector Instance
detector = FatigueDetector()
