# Vision models

`face_detection_yunet_2023mar.onnx` is the YuNet face detector from the
[OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet)
(Apache License 2.0). The facecam script in `worker/scripts/detect_facecam.py`
loads it through OpenCV's `FaceDetectorYN`.
