import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken"


const generateAccessAndRefreshToken=async (userId)=>{
    try {
        const user=await User.findById(userId);

        const accessToken=user.generateAccessToken()
        const refreshToken=user.generateRefreshToken();

        user.refreshToken=refreshToken;
        await user.save({validateBeforeSave : false})

        return {accessToken, refreshToken};

    } catch (error) {
        throw new ApiError(500, "Something went wrong while generating access and refresh tokens")
    }
}

const registerUser=asyncHandler(async (req, res)=>{
    //get user details from frontend
    //validation-not empty
    //check if user already exist : username, email
    //check for images, check for avatar
    //upload them to cloudinary, avatar
    //create user object - create entry in db
    //remove password and refresh token field from response
    //check for user creation
    //return res;

    const {username, email, fullname, password} = req.body;
    if([username, email, fullname, password].some((field)=>field?.trim()==="")){
        throw new ApiError(400, "All fields are required!!")
    }

    const existedUser=await User.findOne({
        $or:[{ username }, { email }]
    })

    if(existedUser){
        throw new ApiError(409, "User already exist")
    }

    const avatarLocalPath=req.files?.avatar?.[0]?.path
    const coverImageLocalPath=req.files?.coverImage?.[0]?.path
    
    if(!avatarLocalPath){
        throw new ApiError(400, "Avatar file is Required!")
    }

    const avatar=await uploadOnCloudinary(avatarLocalPath)
    const coverImage = coverImageLocalPath
        ? await uploadOnCloudinary(coverImageLocalPath)
        : null;

    console.log("Avatar:", avatar);
    if(!avatar){
        throw new ApiError(400, "Avatar is required")
    }

    const user=await User.create(
        {
            fullname, 
            email, 
            password,
            avatar: avatar.url,
            coverImage: coverImage?.url || "",
            username:username.toLowerCase()
        }
    )

    const createdUser=await User.findById(user._id).select(
        "-password -refreshToken"
    )

    if(!createdUser){
        throw new ApiError(500, "Something went wrong while registering user!")
    }

    return res.status(201).json(new ApiResponse(200, createdUser, "User Registered Succesfully"))

})

const loginUser=asyncHandler(async (req, res)=>{
    //req.body -> email, password
    //validation - not empty
    //check if user exist with email
    //compare password with hashed password
    //generate access token and refresh token
    //save refresh token in db
    //return response with access token and refresh token
    
    const {email, username, password}=req.body;
    if(!username && !email){
        throw new ApiError(400, "Username or email is requireed")
    }

    const user=User.findOne({
        $or: [{email}, {username}]
    })

    if(!user){
        throw new ApiError(404, "User does not exist")
    }

    const isPasswordValid=await user.isPasswordCorrect(password)

    if(!isPasswordValid){
        throw new ApiError(401, "Inavalid User Credentials")
    }

    const {accessToken, refreshToken} = await generateAccessAndRefreshToken;

    const loggedInUser =await  User.findById(user._id).select("-password -refreshToken")

    const options={
        httpOnly : true,
        secure : true
    }

    res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
        new ApiResponse(
            200, 
            {
                user: loggedInUser, accessToken, refreshToken
            },
            "User logged in successfully"
        )
    )
})

const logoutUser=asyncHandler(async (req, res)=>{
    //remove accesstoken
    //refresh access and refresh token
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refreshToken: undefined
            }
        },
        {
            new: true
        }
    )

    const options={
        httpOnly : true,
        secure : true
    }

    return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged out"))
})


const refreshAccessToken=asyncHandler(async (req, res)=>{
    try {
        const incommingRefreshToken=req.cookies.refreshToken || req.body.refreshToken

        if(!incommingRefreshToken){
            throw new ApiError(401, "Unauthorized Request")
        }

        const decodedToken=jwt.verify(incommingRefreshToken, process.env.REFRESH_TOKEN_SECRET)

        const user=await User.findById(decodedToken?._id)

        if(!user){
            throw new ApiError(401, "Invalid refresh token")
        }

        if(incommingRefreshToken!==user?.refreshToken){
            throw new ApiError(401, "Refresh token is expired or invalid")
        }

        const options={
            httpOnly : true,
            secure: true
        }

        const {accessToken, NewRefreshToken}=await generateAccessAndRefreshToken(user._id)

        return res
        .status(200)
        .cookie("accessToken", accessToken)
        .cookie("refreshToken", NewRefreshToken)
        .json(
            new ApiResponse(
                200,
                {accessToken, refreshToken : NewRefreshToken},
                "Access Token refreshed"
            )
        )


    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refersh tokken")
    }
})

const changeCurrentPassword=asyncHandler(async (req, res)=>{
    const {oldPassword, newPassword}=req.body

    const user=await User.findById(req.user?._id)

    const isPasswordCorrect=user.isPasswordCorrect(oldPassword)

    if(!isPasswordCorrect){
        throw new ApiError(400, "Invalid old password")
    }

    user.password=newPassword;

    await user.save({validateBeforeSave : false})

    return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password is changed successfully"))

})

const getCurrentUser=asyncHandler(async (req, res)=>{
    return res
    .status(200)
    .json(new ApiResponse(200, req.user, "Current user fetched successfully"))
})

const updateAccountDetails=asyncHandler(async (req, res)=>{
    const {fullname, email}=req.body;

    if(!fullname || !email){
        throw new ApiError(400, "All field are required")
    }

    await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                fullname,
                email
            }
        },
        {new: true}
    ).select("-password -refreshToken")

    return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated"))
})


const updateUserAvatar=asyncHandler(async (req, res)=>{
    const avatarLocalPath=res.file?.path
    if(!avatarLocalPath){
        throw new ApiError(400, "Avatar file missing")
    }

    const avatar=await uploadOnCloudinary(avatarLocalPath)

    if(!avatar.url){
        throw new ApiError(400, "Error while uploading on avatar")
    }

    const user=await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                avatar: avatar.url
            }
        },
        {new : true}
    ).select("-password -refreshToken")

    return res
    .status(200)
    .json(200, user, "Avatar updated successfully")
})

const updateUserCoverImage=asyncHandler(async (req, res)=>{
    const coverImageLocalPath=res.file?.path
    if(!coverImageLocalPath){
        throw new ApiError(400, "CoverImage file missing")
    }

    const coverImage=await uploadOnCloudinary(coverImageLocalPath)

    if(!coverImage.url){
        throw new ApiError(400, "Error while uploading on cover image")
    }

    await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                coverImage: coverImage.url
            }
        },
        {new : true}
    ).select("-password -refreshToken")

    return res
    .status(200)
    .json(200, user, "Cover Image updated successfully")
})


export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverImage
}